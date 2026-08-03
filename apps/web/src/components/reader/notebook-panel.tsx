"use client";

import { useMemo, useState } from "react";
import type { Article, Highlight } from "@booklet/shared";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { SourceIcon } from "@/components/library/source-icon";
import { comparePositionInArticle } from "@/lib/highlights/position-sort";
import { formatReadingTime, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The in-reader right-side panel (Readwise Reader's "Notebook" concept,
 * minus its AI-dependent Chat tab and trial/upgrade messaging, neither of
 * which apply here) -- an Info tab (article metadata) and a Notebook tab
 * (every highlight for THIS article, in reading order, click to jump to
 * it). No document-level note field yet -- that's a real Article schema
 * change (see the issue this shipped from), split out rather than bundled
 * into an already-large first version of this panel.
 */

type NotebookTab = "info" | "highlights";

interface NotebookPanelProps {
  article: Article;
  highlights: Highlight[];
  onJump: (highlight: Highlight) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onSaveNote: (highlightId: string, noteText: string) => void;
  onDeleteNote: (highlightId: string) => void;
}

export function NotebookPanel({
  article,
  highlights,
  onJump,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
}: NotebookPanelProps) {
  const [tab, setTab] = useState<NotebookTab>("highlights");

  const sortedHighlights = useMemo(() => highlights.slice().sort(comparePositionInArticle), [highlights]);

  return (
    <aside
      data-notebook-panel
      className="fixed right-0 top-14 bottom-0 z-30 flex w-[360px] flex-col border-l border-border bg-surface"
    >
      <div className="flex shrink-0 gap-1 border-b border-border p-2" role="tablist" aria-label="Notebook">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "info"}
          onClick={() => setTab("info")}
          className={cn(
            "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
            tab === "info" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "highlights"}
          onClick={() => setTab("highlights")}
          className={cn(
            "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
            tab === "highlights" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          Notebook{highlights.length > 0 ? ` (${highlights.length})` : ""}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "info" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-ink-faint">
              <SourceIcon sourceType={article.sourceType} className="h-4 w-4" />
              <span className="font-sans text-xs uppercase tracking-wide">{article.sourceType}</span>
            </div>
            <h3 className="text-balance font-serif text-lg font-semibold leading-snug text-ink">
              {article.title ?? "Untitled"}
            </h3>
            <dl className="flex flex-col gap-3 font-sans text-sm">
              {(article.author || article.siteName) && (
                <div>
                  <dt className="font-sans text-xs text-ink-faint">Author</dt>
                  <dd className="text-ink">{article.author ?? article.siteName}</dd>
                </div>
              )}
              {article.siteName && (
                <div>
                  <dt className="font-sans text-xs text-ink-faint">Source</dt>
                  <dd className="text-ink">{article.siteName}</dd>
                </div>
              )}
              <div>
                <dt className="font-sans text-xs text-ink-faint">Saved</dt>
                <dd className="text-ink">{formatRelativeDate(article.savedAt)}</dd>
              </div>
              {article.readingTimeEstimate !== null && (
                <div>
                  <dt className="font-sans text-xs text-ink-faint">Reading time</dt>
                  <dd className="text-ink">{formatReadingTime(article.readingTimeEstimate)}</dd>
                </div>
              )}
              {article.originalFilename && (
                <div>
                  <dt className="font-sans text-xs text-ink-faint">File</dt>
                  <dd className="break-all text-ink">{article.originalFilename}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : sortedHighlights.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
            <p className="font-sans text-sm text-ink-muted">No highlights yet for this article.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedHighlights.map((h) => (
              <div
                key={h.id}
                onClick={(e) => {
                  // Clicking a delete/edit control inside the row shouldn't
                  // also jump -- only treat a click on the row itself (or
                  // its quoted text/citation, not an interactive child) as
                  // "take me there."
                  if ((e.target as HTMLElement).closest("button, textarea, a")) return;
                  onJump(h);
                }}
                className="cursor-pointer"
              >
                <HighlightListItem
                  highlight={h}
                  onDelete={onDeleteHighlight}
                  onSaveNote={onSaveNote}
                  onDeleteNote={onDeleteNote}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
