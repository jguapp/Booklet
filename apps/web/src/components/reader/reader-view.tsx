"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, ArticleStatus, Highlight, HighlightColor, TextPosition } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import { loadArticle, updateArticleStatus } from "@/lib/data/articles";
import { loadHighlights, saveHighlights, LOCAL_USER_ID } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";
import { formatReadingTime } from "@/lib/format";
import { ReaderToolbar, type ReaderSize } from "./reader-toolbar";
import { ArticleContent } from "./article-content";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
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

  const refresh = useCallback(() => {
    if (authStatus === "loading") return;
    Promise.all([loadArticle(articleId, isAuthenticated), loadHighlights()]).then(([a, h]) => {
      setArticle(a);
      setHighlights(h);
      setLoaded(true);
    });
  }, [authStatus, isAuthenticated, articleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const articleHighlights = useMemo(
    () => highlights.filter((h) => h.articleId === articleId),
    [highlights, articleId],
  );

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

  function handleCreateHighlight(position: TextPosition, color: HighlightColor, note: string) {
    if (!article) return;
    const now = new Date().toISOString();
    const id = `local-${crypto.randomUUID()}`;
    const trimmedNote = note.trim();

    const highlight: Highlight = {
      id,
      articleId: article.id,
      userId: LOCAL_USER_ID,
      selectedText: position.exact,
      position,
      color,
      lastSurfacedAt: null,
      surfaceCount: 0,
      lastFeedback: null,
      lastFeedbackAt: null,
      resurfaceArchivedAt: null,
      createdAt: now,
      updatedAt: now,
      annotation: trimmedNote
        ? {
            id: `local-${crypto.randomUUID()}`,
            highlightId: id,
            userId: LOCAL_USER_ID,
            noteText: trimmedNote,
            createdAt: now,
            updatedAt: now,
          }
        : null,
    };

    setHighlights((prev) => {
      const next = [...prev, highlight];
      saveHighlights(next);
      return next;
    });
  }

  function handleDeleteHighlight(highlightId: string) {
    setHighlights((prev) => {
      const next = prev.filter((h) => h.id !== highlightId);
      saveHighlights(next);
      return next;
    });
  }

  function handleSaveNote(highlightId: string, noteText: string) {
    const now = new Date().toISOString();
    setHighlights((prev) => {
      const next = prev.map((h) => {
        if (h.id !== highlightId) return h;
        return {
          ...h,
          annotation: h.annotation
            ? { ...h.annotation, noteText, updatedAt: now }
            : {
                id: `local-${crypto.randomUUID()}`,
                highlightId,
                userId: LOCAL_USER_ID,
                noteText,
                createdAt: now,
                updatedAt: now,
              },
        };
      });
      saveHighlights(next);
      return next;
    });
  }

  function handleDeleteNote(highlightId: string) {
    setHighlights((prev) => {
      const next = prev.map((h) => (h.id === highlightId ? { ...h, annotation: null } : h));
      saveHighlights(next);
      return next;
    });
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
  const isRenderable = article.sourceType === "HTML" && article.extractedHtml;

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

        {isRenderable ? (
          <ArticleContent
            html={article.extractedHtml ?? ""}
            highlights={articleHighlights}
            size={size}
            onCreateHighlight={handleCreateHighlight}
            onDeleteHighlight={handleDeleteHighlight}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="rounded-md border border-dashed border-border px-5 py-8 text-center">
              <SourceIcon sourceType={article.sourceType} className="mx-auto mb-3 h-6 w-6 text-ink-faint" />
              <p className="font-sans text-sm text-ink-muted">
                {article.sourceType === "PDF"
                  ? "In-browser PDF rendering (PDF.js) is a follow-up phase."
                  : article.sourceType === "EPUB"
                    ? "In-browser EPUB rendering (epub.js) is a follow-up phase."
                    : "Couldn't extract readable content for this article."}
              </p>
              {article.originalFilename && (
                <p className="mt-1 font-sans text-xs text-ink-faint">{article.originalFilename}</p>
              )}
              {article.extractionError && (
                <p className="mt-1 font-sans text-xs text-ink-faint">{article.extractionError}</p>
              )}
            </div>

            {article.extractedText && (
              <p className="font-serif text-lg leading-relaxed text-ink">{article.extractedText}</p>
            )}

            {articleHighlights.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Highlights in this document
                </h2>
                {articleHighlights.map((h) => (
                  <HighlightListItem
                    key={h.id}
                    highlight={h}
                    onDelete={handleDeleteHighlight}
                    onSaveNote={handleSaveNote}
                    onDeleteNote={handleDeleteNote}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
