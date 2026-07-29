"use client";

import Link from "next/link";
import { useState } from "react";
import type { Article, Highlight, HighlightColor } from "@booklet/shared";
import { formatRelativeDate } from "@/lib/format";
import { IconPencil, IconTrash } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const DOT_CLASS: Record<HighlightColor, string> = {
  YELLOW: "bg-highlight-yellow",
  GREEN: "bg-highlight-green",
  BLUE: "bg-highlight-blue",
  PINK: "bg-highlight-pink",
  ORANGE: "bg-highlight-orange",
};

interface HighlightListItemProps {
  highlight: Highlight;
  /** Pass when this list isn't already scoped to one article (e.g. the Highlights dashboard). */
  article?: Article;
  /** Extra action row, e.g. Daily Review's remembered/forgot/archive buttons. */
  actions?: React.ReactNode;
  onDelete?: (highlightId: string) => void;
  onSaveNote?: (highlightId: string, noteText: string) => void;
  onDeleteNote?: (highlightId: string) => void;
}

export function HighlightListItem({
  highlight,
  article,
  actions,
  onDelete,
  onSaveNote,
  onDeleteNote,
}: HighlightListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.annotation?.noteText ?? "");
  const [confirming, setConfirming] = useState<"highlight" | "note" | null>(null);

  function startEditing() {
    setDraft(highlight.annotation?.noteText ?? "");
    setEditing(true);
  }

  function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onDeleteNote?.(highlight.id);
    } else {
      onSaveNote?.(highlight.id, trimmed);
    }
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[highlight.color]}`} />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base leading-snug text-ink">&ldquo;{highlight.selectedText}&rdquo;</p>

          {editing ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a note…"
                className="w-full resize-none rounded-sm border border-border bg-paper px-2.5 py-2 font-sans text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)} className="px-3 py-1 text-xs">
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave} className="px-3 py-1 text-xs">
                  Save
                </Button>
              </div>
            </div>
          ) : highlight.annotation ? (
            <div className="mt-2 flex items-start justify-between gap-2">
              <p className="font-sans text-sm text-ink-muted">{highlight.annotation.noteText}</p>
              {(onSaveNote || onDeleteNote) && (
                <div className="flex shrink-0 gap-1">
                  {onSaveNote && (
                    <button
                      type="button"
                      title="Edit note"
                      onClick={startEditing}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <IconPencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDeleteNote && (
                    <button
                      type="button"
                      title="Delete note"
                      onClick={() => setConfirming("note")}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            onSaveNote && (
              <button
                type="button"
                onClick={startEditing}
                className="mt-2 font-sans text-xs font-medium text-accent hover:underline"
              >
                + Add a note
              </button>
            )
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs text-ink-faint">
            {article && (
              <Link href={`/reader/${article.id}`} className="font-medium text-accent hover:underline">
                {article.title ?? "Untitled"}
              </Link>
            )}
            {article && <span>·</span>}
            <span>{formatRelativeDate(highlight.createdAt)}</span>
          </div>
        </div>

        {onDelete && (
          <button
            type="button"
            title="Delete highlight"
            onClick={() => setConfirming("highlight")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        )}
      </div>

      {actions && <div className="mt-4 flex justify-end gap-2">{actions}</div>}

      {confirming && (
        <ConfirmDialog
          title={confirming === "highlight" ? "Delete this highlight?" : "Delete this note?"}
          message="This can't be undone."
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming === "highlight") onDelete?.(highlight.id);
            else onDeleteNote?.(highlight.id);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
