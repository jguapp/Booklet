"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Article, ArticleStatus, Highlight, HighlightColor, HighlightPosition } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import { loadArticle, loadArticleFile, updateArticleStatus } from "@/lib/data/articles";
import { createHighlight, deleteHighlight, deleteNote, loadHighlights, saveNote } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatReadingTime } from "@/lib/format";
import { textToParagraphHtml } from "@/lib/reader/text-to-html";
import { ReaderToolbar, type ReaderSize } from "./reader-toolbar";
import { ArticleContent } from "./article-content";
import { PdfReader } from "./pdf-reader";
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
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
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

  // The raw file backs both the real PDF/EPUB readers and the "download
  // original" link. Local (no-account) mode reads it straight from
  // IndexedDB; authenticated mode's file lives behind an auth-gated route
  // (GET /api/articles/:id/file) that a plain <a href> can't send a Bearer
  // token to, so loadArticleFile fetches it as a Blob either way -- see
  // lib/data/articles.ts.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadFile() {
      if (!article || (article.sourceType !== "PDF" && article.sourceType !== "EPUB")) {
        if (!cancelled) {
          setFileBlob(null);
          setDownloadUrl(null);
        }
        return;
      }
      const blob = await loadArticleFile(article.id, isAuthenticated).catch(() => null);
      if (cancelled || !blob) return;
      setFileBlob(blob);
      objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
    }

    loadFile();
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

  async function handleCreateHighlight(
    selectedText: string,
    position: HighlightPosition,
    color: HighlightColor,
    note: string,
  ) {
    if (!article) return;
    const created = await createHighlight(
      { articleId: article.id, selectedText, position, color, noteText: note.trim() || undefined },
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
        <p className="font-serif text-lg text-ink">Couldn&apos;t find that article.</p>
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
  // PDF gets its own real page-rendered reader once the file's loaded (see
  // pdf-reader.tsx). EPUB and a PDF whose file failed to load fall back to
  // the extracted-text-through-the-HTML-highlighter path, same as before.
  const usesPdfReader = article.sourceType === "PDF" && fileBlob !== null;
  const renderHtml = usesPdfReader
    ? null
    : (article.extractedHtml ?? (article.extractedText ? textToParagraphHtml(article.extractedText) : null));
  const isTextRenderable = renderHtml !== null;

  return (
    <div className="min-h-screen bg-paper">
      <ReaderToolbar
        siteName={label}
        theme={theme}
        onThemeChange={setTheme}
        size={size}
        onSizeChange={setSize}
        progress={isTextRenderable ? progress : article.progressFraction}
      />
      <main className={cn("mx-auto px-6 py-12", usesPdfReader ? "max-w-[840px]" : "max-w-[680px]")}>
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
          {isTextRenderable && remainingMinutes !== null ? ` · ${remainingMinutes} min left` : ""}
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
            {article.sourceType === "PDF" ? "PDF" : "EPUB"}
            {!usesPdfReader ? " · shown as extracted text, not the original page layout" : ""}
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

        {usesPdfReader ? (
          <PdfReader
            fileBlob={fileBlob!}
            highlights={highlights}
            onCreateHighlight={(position, color, note) => handleCreateHighlight(position.text, position, color, note)}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : isTextRenderable ? (
          <ArticleContent
            html={renderHtml ?? ""}
            highlights={highlights}
            size={size}
            onCreateHighlight={(position, color, note) => handleCreateHighlight(position.exact, position, color, note)}
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
