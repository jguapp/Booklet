"use client";

import { useEffect, useRef, useState } from "react";
import { IconPencil, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface HighlightManagePopoverProps {
  anchorRect: DOMRect;
  noteText: string;
  onSaveNote: (text: string) => void;
  onDeleteNote: () => void;
  onDeleteHighlight: () => void;
  onDismiss: () => void;
}

export function HighlightManagePopover({
  anchorRect,
  noteText,
  onSaveNote,
  onDeleteNote,
  onDeleteHighlight,
  onDismiss,
}: HighlightManagePopoverProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(noteText);
  const [confirming, setConfirming] = useState<"highlight" | "note" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    function handleScroll() {
      onDismiss();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [onDismiss]);

  function handleSave() {
    const trimmed = draft.trim();
    if (trimmed) onSaveNote(trimmed);
    else onDeleteNote();
    onDismiss();
  }

  // `fixed`, positioned directly from the viewport-relative anchorRect -- see
  // the matching comment in highlight-popover.tsx for why not `absolute`.
  const top = anchorRect.top - 12;
  const left = anchorRect.left + anchorRect.width / 2;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface p-3 shadow-lg"
      style={{ top, left }}
    >
      {editingNote ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            className="w-full resize-none rounded-sm border border-border bg-paper px-2.5 py-2 font-sans text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingNote(false)}
              className="rounded-sm px-3 py-1.5 font-sans text-xs font-semibold text-ink-muted hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-sm bg-accent px-3 py-1.5 font-sans text-xs font-semibold text-accent-contrast hover:bg-accent-strong"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditingNote(true)}
            className="flex flex-1 items-center gap-1.5 rounded-sm px-2 py-1.5 font-sans text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <IconPencil className="h-3.5 w-3.5" />
            {noteText ? "Edit note" : "Add a note"}
          </button>
          {noteText && (
            <button
              type="button"
              onClick={() => setConfirming("note")}
              title="Delete note"
              className="flex h-7 w-7 items-center justify-center rounded-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            onClick={() => setConfirming("highlight")}
            title="Delete highlight"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-ink-muted hover:bg-highlight-orange hover:text-ink"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === "highlight" ? "Delete this highlight?" : "Delete this note?"}
          message="This can't be undone."
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming === "highlight") onDeleteHighlight();
            else onDeleteNote();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
