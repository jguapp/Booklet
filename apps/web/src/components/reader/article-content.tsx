"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Highlight, HighlightColor, TextPositionAnchor, TextQuoteAnchor } from "@booklet/shared";
import { computeAnchor, resolveAnchor } from "@booklet/shared";
import {
  plainTextOf,
  rangeForTextOffsets,
  textOffsetsForRange,
  wrapRangeInElements,
} from "@/lib/reader/dom-range";
import { HighlightPopover } from "./highlight-popover";
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
}

interface ArticleContentProps {
  html: string;
  highlights: Highlight[];
  size: ReaderSize;
  onCreateHighlight: (anchor: TextQuoteAnchor & TextPositionAnchor, color: HighlightColor, note: string) => void;
}

export function ArticleContent({ html, highlights, size, onCreateHighlight }: ArticleContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  // Re-apply highlight marks whenever the highlight list or underlying html changes.
  // This is the same resolveAnchor() used server-side-adjacent (packages/shared),
  // so drift-tolerant re-anchoring is exercised for real, not simulated.
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
      const resolution = resolveAnchor(fullText, {
        exact: highlight.selectedText,
        prefix: highlight.prefix,
        suffix: highlight.suffix,
        start: highlight.startOffset,
        end: highlight.endOffset,
      });
      if (resolution.status === "unresolved") continue;

      const range = rangeForTextOffsets(container, resolution.start, resolution.end);
      if (!range) continue;

      const marks = wrapRangeInElements(container, range, () => {
        const mark = document.createElement("mark");
        mark.dataset.highlightId = highlight.id;
        mark.className = `${HIGHLIGHT_CLASS[highlight.color]} rounded-[3px] text-inherit`;
        (mark.style as CSSStyleDeclaration & { boxDecorationBreak?: string }).boxDecorationBreak = "clone";
        mark.style.setProperty("-webkit-box-decoration-break", "clone");
        return mark;
      });
      marksByHighlight.set(highlight.id, marks);
    }

    // Pass 2: note pills insert extra text nodes into the container, which
    // would shift every subsequent DOM-offset lookup above if interleaved --
    // so this only runs once all offset-sensitive work is done.
    for (const highlight of highlights) {
      if (!highlight.annotation) continue;
      const marks = marksByHighlight.get(highlight.id);
      if (!marks || marks.length === 0) continue;

      const pill = document.createElement("span");
      pill.className =
        "note-pill inline-flex items-center gap-1 ml-1.5 rounded-full border border-border bg-surface px-2 py-0.5 align-middle font-sans text-xs font-medium text-accent whitespace-nowrap";
      pill.title = highlight.annotation.noteText;
      pill.innerHTML =
        '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12M2 8h8M2 13h5"/></svg>';
      const label = document.createElement("span");
      const text = highlight.annotation.noteText;
      label.textContent = text.length > 44 ? `${text.slice(0, 44)}…` : text;
      pill.appendChild(label);
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

    setPending({ start, end, rect });
  }

  function handleConfirm(color: HighlightColor, note: string) {
    const container = containerRef.current;
    if (!pending || !container) return;
    const fullText = plainTextOf(container);
    const anchor = computeAnchor(fullText, pending.start, pending.end);
    onCreateHighlight(anchor, color, note);
    setPending(null);
    window.getSelection()?.removeAllRanges();
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
        className="font-serif text-ink [&_p]:mb-5 [&_em]:italic [&_strong]:font-semibold"
        style={{ fontSize, lineHeight }}
        dangerouslySetInnerHTML={dangerousHtml}
      />
      {pending && (
        <HighlightPopover
          anchorRect={pending.rect}
          onConfirm={handleConfirm}
          onDismiss={() => setPending(null)}
        />
      )}
    </div>
  );
}
