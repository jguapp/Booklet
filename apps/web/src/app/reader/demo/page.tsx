"use client";

import { useEffect, useState } from "react";
import type { Highlight, HighlightColor, TextPositionAnchor, TextQuoteAnchor } from "@booklet/shared";
import { useTheme } from "@/lib/theme/theme-provider";
import { mockArticle, mockHighlights } from "@/lib/reader/mock-data";
import { loadPersistedHighlights, savePersistedHighlights } from "@/lib/reader/mock-persistence";
import { ReaderToolbar, type ReaderSize } from "@/components/reader/reader-toolbar";
import { ArticleContent } from "@/components/reader/article-content";

export default function ReaderDemoPage() {
  const { theme, setTheme } = useTheme();
  const [size, setSize] = useState<ReaderSize>("md");
  const [highlights, setHighlights] = useState<Highlight[]>(mockHighlights);
  const [progress, setProgress] = useState(0);

  // SSR renders the base mock set (localStorage isn't available server-side);
  // swap in any persisted highlights once mounted.
  useEffect(() => {
    setHighlights(loadPersistedHighlights(mockHighlights));
  }, []);

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

  function handleCreateHighlight(
    anchor: TextQuoteAnchor & TextPositionAnchor,
    color: HighlightColor,
    note: string,
  ) {
    const now = new Date().toISOString();
    const id = `local-${crypto.randomUUID()}`;
    const trimmedNote = note.trim();

    const highlight: Highlight = {
      id,
      articleId: mockArticle.id,
      userId: mockArticle.userId,
      selectedText: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      startOffset: anchor.start,
      endOffset: anchor.end,
      color,
      lastSurfacedAt: null,
      surfaceCount: 0,
      createdAt: now,
      updatedAt: now,
      annotation: trimmedNote
        ? {
            id: `local-${crypto.randomUUID()}`,
            highlightId: id,
            userId: mockArticle.userId,
            noteText: trimmedNote,
            createdAt: now,
            updatedAt: now,
          }
        : null,
    };

    setHighlights((prev) => {
      const next = [...prev, highlight];
      savePersistedHighlights(next);
      return next;
    });
  }

  const remainingMinutes = mockArticle.readingTimeEstimate
    ? Math.max(0, Math.round(mockArticle.readingTimeEstimate * (1 - progress)))
    : null;

  return (
    <div className="min-h-screen bg-paper">
      <ReaderToolbar
        siteName={mockArticle.siteName}
        theme={theme}
        onThemeChange={setTheme}
        size={size}
        onSizeChange={setSize}
        progress={progress}
      />
      <main className="mx-auto max-w-[680px] px-6 py-12">
        <h1 className="mb-3 text-balance font-serif text-[34px] font-semibold leading-tight text-ink">
          {mockArticle.title}
        </h1>
        <p className="mb-9 font-sans text-xs text-ink-faint">
          {mockArticle.siteName}
          {mockArticle.readingTimeEstimate ? ` · ${mockArticle.readingTimeEstimate} min read` : ""}
          {remainingMinutes !== null ? ` · ${remainingMinutes} min left` : ""}
        </p>
        <ArticleContent
          html={mockArticle.extractedHtml ?? ""}
          highlights={highlights}
          size={size}
          onCreateHighlight={handleCreateHighlight}
        />
      </main>
    </div>
  );
}
