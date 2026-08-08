"use client";

import Link from "next/link";
import { useState } from "react";
import type { Article, Highlight } from "@booklet/shared";
import { MAX_RECALL_PROMPT_LENGTH, highlightColorHex } from "@booklet/shared";
import { formatRelativeDate } from "@/lib/format";
import { highlightCitation } from "@/lib/highlights/citation";
import { IconPencil, IconTrash } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HIGHLIGHT_DRAG_MIME } from "@/lib/dnd/trash-drop";

interface HighlightListItemProps {
  highlight: Highlight;
  /** Pass when this list isn't already scoped to one article (e.g. the Highlights dashboard). */
  article?: Article;
  /** The owning article's extractedText, for computing a "Paragraph N"
   * citation on HTML/text highlights -- separate from `article` since a
   * caller already scoped to one article (the reader's own Notebook panel)
   * still needs this for the citation even though it deliberately omits
   * `article` to skip the redundant self-referential title link. Ignored
   * when `article` is passed -- that already carries extractedText. */
  articleExtractedText?: string | null;
  /** Extra bit of metadata appended to the citation/date row -- e.g. Daily
   * Review's library section uses this for "Due in N days" transparency. */
  extraMeta?: string;
  /** Extra action row, e.g. Daily Review's remembered/forgot/archive buttons. */
  actions?: React.ReactNode;
  /** Retrieval mode (#157): show the highlight's prompt and keep the passage
   * itself -- and its note, which usually gives the answer away too --
   * hidden until `onReveal` fires. Ignored for a highlight with no prompt,
   * since there is nothing to ask; those render normally. */
  concealed?: boolean;
  onReveal?: () => void;
  onDelete?: (highlightId: string) => void;
  onSaveNote?: (highlightId: string, noteText: string) => void;
  onDeleteNote?: (highlightId: string) => void;
  /** Pass both to offer adding/editing/removing a recall prompt. Saving an
   * empty prompt removes it, matching how notes behave above. */
  onSavePrompt?: (highlightId: string, prompt: string) => void;
  onDeletePrompt?: (highlightId: string) => void;
}

export function HighlightListItem({
  highlight,
  article,
  articleExtractedText,
  extraMeta,
  actions,
  concealed,
  onReveal,
  onDelete,
  onSaveNote,
  onDeleteNote,
  onSavePrompt,
  onDeletePrompt,
}: HighlightListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(highlight.annotation?.noteText ?? "");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(highlight.prompt ?? "");
  const [confirming, setConfirming] = useState<"highlight" | "note" | null>(null);
  const citation = highlightCitation(highlight, article?.extractedText ?? articleExtractedText);

  // A prompt is what makes concealment meaningful; without one there is no
  // question to show in the passage's place, so an unprompted highlight
  // renders exactly as it always has even in a concealed list.
  const concealing = !!concealed && !!highlight.prompt;

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

  function startEditingPrompt() {
    setPromptDraft(highlight.prompt ?? "");
    setEditingPrompt(true);
  }

  function handleSavePrompt() {
    const trimmed = promptDraft.trim();
    if (!trimmed) onDeletePrompt?.(highlight.id);
    else onSavePrompt?.(highlight.id, trimmed);
    setEditingPrompt(false);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(HIGHLIGHT_DRAG_MIME, highlight.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-md border border-border bg-surface px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: highlightColorHex(highlight.color) }}
        />
        <div className="min-w-0 flex-1">
          {concealing ? (
            // The whole point of #157: the question occupies the slot the
            // passage normally would, and the passage stays out of sight
            // until the reader has actually tried to answer. Grading before
            // this button is pressed is what turns SM-2 into a re-read
            // scheduler, so Daily Review withholds the grade buttons too.
            <>
              <p className="font-serif text-base leading-snug text-ink">{highlight.prompt}</p>
              <button
                type="button"
                onClick={onReveal}
                className="mt-3 rounded-sm border border-border px-3 py-1.5 font-sans text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Show the highlight
              </button>
            </>
          ) : (
            <>
              {highlight.prompt && !editingPrompt && (
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <p className="font-sans text-sm font-medium text-ink-muted">{highlight.prompt}</p>
                  {(onSavePrompt || onDeletePrompt) && (
                    <div className="flex shrink-0 gap-1">
                      {onSavePrompt && (
                        <button
                          type="button"
                          title="Edit prompt"
                          onClick={startEditingPrompt}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {onDeletePrompt && (
                        <button
                          type="button"
                          title="Remove prompt"
                          onClick={() => onDeletePrompt(highlight.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className="font-serif text-base leading-snug text-ink">&ldquo;{highlight.selectedText}&rdquo;</p>
            </>
          )}

          {!concealing && editingPrompt && (
            <div className="mt-2.5 flex flex-col gap-2">
              <textarea
                autoFocus
                rows={2}
                maxLength={MAX_RECALL_PROMPT_LENGTH}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                aria-label="Recall prompt"
                placeholder="Ask a question this highlight answers…"
                className="w-full resize-none rounded-sm border border-border bg-paper px-2.5 py-2 font-sans text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditingPrompt(false)} className="px-3 py-1 text-xs">
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSavePrompt} className="px-3 py-1 text-xs">
                  Save
                </Button>
              </div>
            </div>
          )}

          {concealing ? null : editing ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Note"
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

          {!concealing && !highlight.prompt && !editingPrompt && onSavePrompt && (
            <button
              type="button"
              onClick={startEditingPrompt}
              // Titled by what it buys you, not by what it is -- "recall
              // prompt" means nothing until you've seen one work.
              title="Ask yourself this before seeing the highlight in Daily Review"
              className="mt-2 block font-sans text-xs font-medium text-accent hover:underline"
            >
              + Add a recall prompt
            </button>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs text-ink-faint">
            {article && (
              <Link href={`/reader/${article.id}`} className="font-medium text-accent hover:underline">
                {article.title ?? "Untitled"}
              </Link>
            )}
            {article && <span>·</span>}
            {citation && (
              <>
                <span>{citation}</span>
                <span>·</span>
              </>
            )}
            <span>{formatRelativeDate(highlight.createdAt)}</span>
            {extraMeta && (
              <>
                <span>·</span>
                <span>{extraMeta}</span>
              </>
            )}
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
