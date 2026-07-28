"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Article, ArticleStatus, Highlight, HighlightColor, TextPosition } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import { loadArticle, updateArticleStatus } from "@/lib/data/articles";
import { createHighlight, deleteHighlight, deleteNote, loadHighlights, saveNote } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatReadingTime } from "@/lib/format";
import { textToParagraphHtml } from "@/lib/reader/text-to-html";
import { localFiles } from "@/lib/local/db";
import { ReaderToolbar, type ReaderSize } from "./reader-toolbar";
import { ArticleContent } from "./article-content";
import { SourceIcon } from "@/components/library/source-icon";
import { cn } from "@/lib/cn";

const STATUS_TABS: { value: ArticleStatus; label: string }[] = [
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

export function ReaderView({ articleId }: { articleId: string }) {
  const { theme, setTheme } = useTheme();
  const { status: authStatus, isAuthenticated } = useAuth();
  const [size, setSize] = useState<ReaderSize>("md");
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (authStatus === "loading") return;
    Promise.all([loadArticle(articleId, isAuthenticated), loadHighlights(isAuthenticated, articleId)]).then(
      ([a, h]) => {
        setArticle(a);
        setHighlights(h);
        setLoaded(true);
      },
    );
  }, [authStatus, isAuthenticated, articleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Local (no-account) uploads keep the raw file in IndexedDB -- offer a
  // "download original" link when it's there. Authenticated mode's file
  // lives server-side behind an auth header a plain <a> can't send, so this
  // is local-only for now.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadLocalFile() {
      if (isAuthenticated || !article || (article.sourceType !== "PDF" && article.sourceType !== "EPUB")) {
        if (!cancelled) setDownloadUrl(null);
        return;
      }
      const file = await localFiles.get(article.id);
      if (cancelled || !file) return;
      objectUrl = URL.createObjectURL(file.blob);
      setDownloadUrl(objectUrl);
    }

    loadLocalFile();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [article, isAuthenticated]);

  useEffect(() => {
    function handleScroll() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  async function handleCreateHighlight(position: TextPosition, color: HighlightColor, note: string) {
    if (!article) return;
    const created = await createHighlight(
      { articleId: article.id, selectedText: position.exact, position, color, noteText: note.trim() || undefined },
      isAuthenticated,
    );
    setHighlights((prev) => [...prev, created]);
  }

  async function handleDeleteHighlight(highlightId: string) {
    await deleteHighlight(highlightId, isAuthenticated);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
  }

  async function handleSaveNote(highlightId: string, noteText: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveNote(target, noteText, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  async function handleDeleteNote(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await deleteNote(target, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  async function handleStatusChange(nextStatus: ArticleStatus) {
    if (!article) return;
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticle(updated);
  }

  if (!loaded) return null;

  if (!article) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
        <p className="font-serif text-lg text-ink">Couldn't find that article.</p>
        <Link href="/library" className="font-sans text-sm font-medium text-accent">
          Back to Library
        </Link>
      </div>
    );
  }

  const remainingMinutes = article.readingTimeEstimate
    ? Math.max(0, Math.round(article.readingTimeEstimate * (1 - progress)))
    : null;
  const label = article.siteName ?? article.author ?? article.originalFilename ?? "Reader";
  // PDF/EPUB render through the same text-selection highlighter as HTML --
  // extracted text wrapped in <p> tags instead of Readability's own markup.
  // Page/chapter layout doesn't survive that, but selecting and highlighting does.
  const renderHtml = article.extractedHtml ?? (article.extractedText ? textToParagraphHtml(article.extractedText) : null);
  const isRenderable = renderHtml !== null;

  return (
    <div className="min-h-screen bg-paper">
      <ReaderToolbar
        siteName={label}
        theme={theme}
        onThemeChange={setTheme}
        size={size}
        onSizeChange={setSize}
        progress={isRenderable ? progress : article.progressFraction}
      />
      <main className="mx-auto max-w-[680px] px-6 py-12">
        <div className="mb-4 flex items-center gap-2 text-ink-faint">
          <SourceIcon sourceType={article.sourceType} className="h-4 w-4" />
          <span className="font-sans text-xs uppercase tracking-wide">{article.sourceType}</span>
        </div>

        <h1 className="mb-3 text-balance font-serif text-[34px] font-semibold leading-tight text-ink">
          {article.title}
        </h1>
        <p className="mb-5 font-sans text-xs text-ink-faint">
          {label}
          {article.readingTimeEstimate ? ` · ${formatReadingTime(article.readingTimeEstimate)}` : ""}
          {isRenderable && remainingMinutes !== null ? ` · ${remainingMinutes} min left` : ""}
        </p>

        <div className="mb-9 flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Article status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => handleStatusChange(t.value)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-xs font-medium transition-colors",
                article.status === t.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {article.sourceType !== "HTML" && (
          <p className="mb-6 font-sans text-xs text-ink-faint">
            {article.sourceType === "PDF" ? "PDF" : "EPUB"} · shown as extracted text, not the original page layout
            {article.originalFilename ? ` · ${article.originalFilename}` : ""}
            {downloadUrl && (
              <>
                {" · "}
                <a href={downloadUrl} download={article.originalFilename ?? undefined} className="text-accent">
                  Download original
                </a>
              </>
            )}
          </p>
        )}

        {isRenderable ? (
          <ArticleContent
            html={renderHtml ?? ""}
            highlights={highlights}
            size={size}
            onCreateHighlight={handleCreateHighlight}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
            <SourceIcon sourceType={article.sourceType} className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
            <p className="font-sans text-sm text-ink-muted">
              {article.extractionError ?? "Couldn't extract readable content for this article."}
            </p>
            {article.originalFilename && (
              <p className="mt-1 font-sans text-xs text-ink-faint">{article.originalFilename}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
