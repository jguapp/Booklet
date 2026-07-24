"use client";

import { useEffect, useRef, useState } from "react";
import type { HighlightColor } from "@booklet/shared";
import { cn } from "@/lib/cn";

const COLORS: { value: HighlightColor; className: string; label: string }[] = [
  { value: "YELLOW", className: "bg-highlight-yellow", label: "Yellow" },
  { value: "GREEN", className: "bg-highlight-green", label: "Green" },
  { value: "BLUE", className: "bg-highlight-blue", label: "Blue" },
  { value: "PINK", className: "bg-highlight-pink", label: "Pink" },
  { value: "ORANGE", className: "bg-highlight-orange", label: "Orange" },
];

interface HighlightPopoverProps {
  /** Viewport position to anchor the popover above (e.g. selection bounding rect). */
  anchorRect: DOMRect;
  onConfirm: (color: HighlightColor, note: string) => void;
  onDismiss: () => void;
}

export function HighlightPopover({ anchorRect, onConfirm, onDismiss }: HighlightPopoverProps) {
  const [color, setColor] = useState<HighlightColor>("YELLOW");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onDismiss]);

  const top = anchorRect.top + window.scrollY - 12;
  const left = anchorRect.left + window.scrollX + anchorRect.width / 2;

  return (
    <div
      ref={ref}
      className="absolute z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface p-3 shadow-lg"
      style={{ top, left }}
    >
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.label}
            onClick={() => {
              setColor(c.value);
              if (!noteOpen) onConfirm(c.value, "");
            }}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
              c.className,
              color === c.value ? "border-ink" : "border-transparent",
            )}
          />
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          title="Add a note"
          onClick={() => setNoteOpen((v) => !v)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink",
            noteOpen && "bg-surface-2 text-accent",
          )}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
            <path d="M2 3h12M2 8h8M2 13h5" />
          </svg>
        </button>
      </div>

      {noteOpen && (
        <div className="mt-2.5 flex flex-col gap-2">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="w-56 resize-none rounded-sm border border-border bg-paper px-2.5 py-2 font-sans text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="button"
            onClick={() => onConfirm(color, note)}
            className="self-end rounded-sm bg-accent px-3 py-1.5 font-sans text-xs font-semibold text-accent-contrast hover:bg-accent-strong"
          >
            Save highlight
          </button>
        </div>
      )}
    </div>
  );
}
