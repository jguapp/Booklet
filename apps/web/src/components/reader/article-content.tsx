"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Highlight, HighlightColor, TextPosition } from "@booklet/shared";
import { computeTextPosition, resolveTextPosition } from "@booklet/shared";
import {
  plainTextOf,
  rangeForTextOffsets,
  textOffsetsForRange,
  wrapRangeInElements,
} from "@/lib/reader/dom-range";
import { HighlightPopover } from "./highlight-popover";
import { HighlightManagePopover } from "./highlight-manage-popover";
import type { ReaderSize } from "./reader-toolbar";

const HIGHLIGHT_CLASS: Record<HighlightColor, string> = {
  YELLOW: "bg-highlight-yellow",
  GREEN: "bg-highlight-green",
  BLUE: "bg-highlight-blue",
  PINK: "bg-highlight-pink",
  ORANGE: "bg-highlight-orange",
};

const SIZE_STYLE: Record<ReaderSize, { fontSize: string; lineHeight: string }> = {
  sm: { fontSize: "17px", lineHeight: "1.6" },
  md: { fontSize: "19px", lineHeight: "1.65" },
  lg: { fontSize: "21px", lineHeight: "1.7" },
  xl: { fontSize: "24px", lineHeight: "1.75" },
};

interface PendingSelection {
  start: number;
  end: number;
  rect: DOMRect;
  text: string;
}

interface ManagingHighlight {
  highlight: Highlight;
  rect: DOMRect;
}

interface ArticleContentProps {
  html: string;
  highlights: Highlight[];
  size: ReaderSize;
  onCreateHighlight: (position: TextPosition, color: HighlightColor, note: string) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onSaveNote: (highlightId: string, noteText: string) => void;
  onDeleteNote: (highlightId: string) => void;
}

export function ArticleContent({
  html,
  highlights,
  size,
  onCreateHighlight,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
}: ArticleContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [managing, setManaging] = useState<ManagingHighlight | null>(null);

  // Re-apply highlight marks whenever the highlight list or underlying html changes.
  // This is the same resolveTextPosition() from packages/shared, so
  // drift-tolerant re-anchoring is exercised for real, not simulated.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.querySelectorAll("mark[data-highlight-id]").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    container.querySelectorAll(".note-pill").forEach((pill) => pill.remove());

    const fullText = plainTextOf(container);

    // Pass 1: resolve + wrap every highlight first. Wrapping only splits
    // existing text nodes (no net new characters), so offsets computed from
    // `fullText` stay valid across iterations within this pass.
    const marksByHighlight = new Map<string, HTMLElement[]>();
    for (const highlight of highlights) {
      // This renderer only knows how to place "text" positions -- a PDF/EPUB
      // highlight has no meaning inside an HTML article's DOM.
      if (highlight.position.type !== "text") continue;

      const resolution = resolveTextPosition(fullText, highlight.position);
      if (resolution.status === "unresolved") continue;

      const range = rangeForTextOffsets(container, resolution.start, resolution.end);
      if (!range) continue;

      const marks = wrapRangeInElements(container, range, () => {
        const mark = document.createElement("mark");
        mark.dataset.highlightId = highlight.id;
        mark.className = `${HIGHLIGHT_CLASS[highlight.color]} cursor-pointer rounded-[3px] text-inherit`;
        (mark.style as CSSStyleDeclaration & { boxDecorationBreak?: string }).boxDecorationBreak = "clone";
        mark.style.setProperty("-webkit-box-decoration-break", "clone");
        return mark;
      });
      marksByHighlight.set(highlight.id, marks);
    }

    // Pass 2: note pills insert an extra element into the container, which
    // would shift every subsequent DOM-offset lookup above if interleaved --
    // so this only runs once all offset-sensitive work is done. Icon-only,
    // Apple Books style: the note's own text never sits in the reading flow,
    // only a marker that there is one -- click it (handleContainerClick) to
    // actually read it in HighlightManagePopover.
    for (const highlight of highlights) {
      if (!highlight.annotation) continue;
      const marks = marksByHighlight.get(highlight.id);
      if (!marks || marks.length === 0) continue;

      const pill = document.createElement("span");
      pill.dataset.highlightId = highlight.id;
      pill.className =
        "note-pill inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center ml-1 rounded-full border border-border bg-surface align-middle text-accent";
      pill.title = "Has a note -- click to read";
      pill.innerHTML =
        '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12M2 8h8M2 13h5"/></svg>';
      marks[marks.length - 1].after(pill);
    }
  }, [highlights, html]);

  function handleMouseUp() {
    const selection = window.getSelection();
    const container = containerRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) return;

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const { start, end } = textOffsetsForRange(container, range);
    if (start === end) return;

    setPending({ start, end, rect, text: range.toString() });
  }

  function handleConfirm(color: HighlightColor, note: string) {
    const container = containerRef.current;
    if (!pending || !container) return;
    const fullText = plainTextOf(container);
    const position = computeTextPosition(fullText, pending.start, pending.end);
    onCreateHighlight(position, color, note);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  function handleContainerClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const marker = target.closest<HTMLElement>("mark[data-highlight-id], .note-pill[data-highlight-id]");
    if (!marker) return;

    const highlightId = marker.dataset.highlightId;
    const highlight = highlights.find((h) => h.id === highlightId);
    if (!highlight) return;

    setManaging({ highlight, rect: marker.getBoundingClientRect() });
  }

  const { fontSize, lineHeight } = SIZE_STYLE[size];

  // React only skips re-touching a dangerouslySetInnerHTML node when the
  // *object reference* it's given is stable across renders -- a fresh
  // `{ __html: html }` literal every render makes React re-apply innerHTML
  // (and wipe the marks/pills injected above) on every unrelated re-render.
  const dangerousHtml = useMemo(() => ({ __html: html }), [html]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        data-article-content
        onMouseUp={handleMouseUp}
        onClick={handleContainerClick}
        className="font-serif text-ink [&_p]:mb-5 [&_em]:italic [&_strong]:font-semibold"
        style={{ fontSize, lineHeight }}
        dangerouslySetInnerHTML={dangerousHtml}
      />
      {pending && (
        <HighlightPopover
          anchorRect={pending.rect}
          selectedText={pending.text}
          onConfirm={handleConfirm}
          onDismiss={() => setPending(null)}
        />
      )}
      {managing && (
        <HighlightManagePopover
          anchorRect={managing.rect}
          noteText={managing.highlight.annotation?.noteText ?? ""}
          onSaveNote={(text) => {
            onSaveNote(managing.highlight.id, text);
            setManaging(null);
          }}
          onDeleteNote={() => {
            onDeleteNote(managing.highlight.id);
            setManaging(null);
          }}
          onDeleteHighlight={() => {
            onDeleteHighlight(managing.highlight.id);
            setManaging(null);
          }}
          onDismiss={() => setManaging(null)}
        />
      )}
    </div>
  );
}
