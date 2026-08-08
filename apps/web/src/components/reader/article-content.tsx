"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Highlight, HighlightColor, TextPosition } from "@booklet/shared";
import { computeTextPosition, highlightColorHex, isLegacyHighlightColor, resolveTextPosition } from "@booklet/shared";
import {
  createOffsetPointFinder,
  plainTextOf,
  rangeForTextOffsets,
  textOffsetsForRange,
  wrapRangeInElements,
} from "@/lib/reader/dom-range";
import { sanitizeArticleHtml } from "@/lib/reader/sanitize";
import { HighlightPopover } from "./highlight-popover";
import { HighlightManagePopover } from "./highlight-manage-popover";
import type { ReaderSize } from "./reader-toolbar";

// The five legacy names render via these theme-aware CSS custom properties
// (see globals.css) so they still auto-adapt across light/dark/sepia/
// Kindle exactly as before. Anything else -- a curated-palette pick beyond
// the original five, or a fully custom hex -- has no per-theme variant to
// fall back to, so it renders as the same literal color in every theme via
// an inline style instead (see highlightColorStyle below).
const LEGACY_HIGHLIGHT_CLASS: Record<string, string> = {
  YELLOW: "bg-highlight-yellow",
  GREEN: "bg-highlight-green",
  BLUE: "bg-highlight-blue",
  PINK: "bg-highlight-pink",
  ORANGE: "bg-highlight-orange",
};

function applyHighlightColor(el: HTMLElement, color: string): void {
  if (isLegacyHighlightColor(color)) {
    el.classList.add(LEGACY_HIGHLIGHT_CLASS[color]);
  } else {
    el.style.backgroundColor = highlightColorHex(color);
  }
}

// Readwise-style "which paragraph is the TTS bot on" indicator -- a left
// border on the nearest block ancestor, not the word-level highlight below
// (that one moves several times a second; this one moves every few
// seconds, one section at a time, and stays legible from a glance instead
// of needing to track exact position).
const SECTION_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, figcaption, pre, td, th, dd, dt, div, section, article";

// Real extracted article HTML -- Wikipedia's infobox/taxonomy markup
// especially -- routinely has real text sitting directly in a <div> or
// other container closest() above doesn't match, with no <p>/<li> wrapper
// at all. closest() finding nothing used to mean this simply returned
// null, and the caller had nothing to fall back to -- confirmed by hand
// this is why the section bar would intermittently vanish mid-read rather
// than just moving less precisely: not a rare edge case, a real, common
// shape of real content. Walking up to the nearest direct child of the
// container itself as a last resort guarantees *some* element is always
// picked, as long as the point is inside the container at all.
//
// `container` itself is a <div>, and SECTION_SELECTOR matches "div" --
// Node#contains() is self-inclusive, so for content with no wrapping
// element nearer than the container (flat markup with no <p> tags at
// all, text sitting directly in the article root), closest() matched
// *the container itself*, and excluding just that one specific element
// (an earlier version of this fix) turned out not to be enough: real
// extracted HTML routinely has a *different*, non-container wrapper div
// that's nearly as broad -- e.g. Readability output where most of the
// article is <p>-wrapped but some loose text (a caption, a trailing
// byline) sits directly in the div that also contains every paragraph,
// so that div is the "nearest match" for that one chunk even though it
// spans virtually the whole article. Excluding a specific element can't
// generalize to every such shape.
//
// A size/character-count heuristic was tried here first (reject if the
// matched element's own text is too large a share of the whole
// article) and confirmed by hand *not* to generalize either: it needs
// an absolute-size escape hatch so a short article's one legitimately
// long paragraph isn't rejected, and that escape hatch trivially passes
// *anything* in a short-to-medium article (well under a few thousand
// characters total, a completely ordinary article length), silently
// disabling the whole guard exactly when it's needed. The actual
// structural signal that generalizes: closest() finds the *nearest*
// matching ancestor, so the only way that match still *contains other*
// SECTION_SELECTOR elements is if the starting point is loose text
// sitting outside all of them -- i.e. the match is a wrapper around
// multiple real sections, not a section itself. No size numbers to
// tune, and it's correct at every article length.
function isReasonablyScoped(el: HTMLElement): boolean {
  return el.querySelector(SECTION_SELECTOR) === null;
}

// Real extracted article HTML -- Wikipedia's infobox/taxonomy markup
// especially -- routinely has real text sitting directly in a <div> or
// other container closest() above doesn't match, with no <p>/<li> wrapper
// at all. closest() finding nothing used to mean this simply returned
// null, and the caller had nothing to fall back to -- confirmed by hand
// this is why the section bar would intermittently vanish mid-read rather
// than just moving less precisely: not a rare edge case, a real, common
// shape of real content. Walking up to the nearest direct child of the
// container itself as a last resort guarantees *some* element is always
// picked, as long as the point is inside the container at all -- but
// every candidate this function considers, on either path, has to clear
// isReasonablyScoped before it's trusted: there's no meaningful
// sub-section to point at when the "nearest" match is actually a
// wrapper around several real sections, so no indicator is the honest
// answer, not the whole page.
export function nearestSectionEl(node: Node, container: HTMLElement): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  if (!el || el === container) return null;
  const specific = el.closest<HTMLElement>(SECTION_SELECTOR);
  if (specific && specific !== container && container.contains(specific)) {
    return isReasonablyScoped(specific) ? specific : null;
  }
  let current: HTMLElement | null = el;
  while (current && current.parentElement !== container) {
    current = current.parentElement;
  }
  if (!current || current === container) return null;
  return isReasonablyScoped(current) ? current : null;
}

// A chunk that begins exactly where a text node ends resolves to that
// *earlier* node -- the same document position as the start of the next
// one, and interchangeable for a Range, but not for nearestSectionEl, which
// reads the node's parentElement to decide which block to mark. The shape
// that exposes it: whitespace sitting directly inside a wrapping element
// (an <article>, a Readability page <div>) just before its first real <p>,
// which is ordinary output for indented source HTML. A chunk starting at
// that paragraph's first character resolved to the whitespace, whose parent
// is the wrapper -- and since the wrapper contains every *other* paragraph
// too, nearestSectionEl's own "is this scoped to one section" guard
// correctly refused it, so no section highlighted at all until playback
// reached a chunk starting mid-paragraph.
//
// Only the section indicator needs this. The offset finder itself is
// deliberately left alone: it's shared with highlight rendering, where the
// *end* point decides which text nodes get wrapped in <mark>, and biasing
// that forward would change what gets wrapped.
export function sectionAnchorNode(point: { node: Text; offset: number }, container: HTMLElement): Node {
  if (point.offset < point.node.data.length) return point.node;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  walker.currentNode = point.node;
  let next = walker.nextNode() as Text | null;
  while (next && next.data.length === 0) next = walker.nextNode() as Text | null;
  return next ?? point.node;
}

interface WordRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

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
  /** The exact text of the TTS chunk currently playing (see
   * tts-player-provider.tsx), or null when nothing's playing / a non-HTML
   * reader has the article open. Used to locate the chunk in the DOM once
   * per chunk (scroll-into-view + the section left-bar), and as the
   * coordinate space readingWordRange's offsets are relative to. */
  readingChunkText?: string | null;
  /** Character offsets of the word currently being spoken, relative to the
   * start of readingChunkText -- estimated, see tts-player-provider.tsx's
   * playKokoro. Re-rendered several times a second while playing, so
   * unlike readingChunkText this drives a read-only geometry overlay
   * (Range#getClientRects(), below) rather than actually wrapping/
   * unwrapping DOM nodes on every update. */
  readingWordRange?: { start: number; end: number } | null;
}

export function ArticleContent({
  html,
  highlights,
  size,
  onCreateHighlight,
  onDeleteHighlight,
  onSaveNote,
  onDeleteNote,
  readingChunkText = null,
  readingWordRange = null,
}: ArticleContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [managing, setManaging] = useState<ManagingHighlight | null>(null);
  const [wordRects, setWordRects] = useState<WordRect[]>([]);
  // Set once per chunk (effect below) so the much-more-frequent word-level
  // effect can translate readingWordRange's chunk-relative offsets into
  // real fullText offsets in O(1), instead of re-running the whitespace-
  // normalized search (a full pass over the article's text) on every word.
  const chunkOffsetMapRef = useRef<{ map: number[]; normalizedChunkStart: number } | null>(null);
  const activeSectionElRef = useRef<HTMLElement | null>(null);

  // Inlined article images are real (up to a few MB) base64 data: URIs
  // (see apps/api's extraction-service.ts) -- decoding several of those
  // synchronously on first paint is real main-thread work, and it's been
  // implicated in occasional stalls during read-along specifically (the
  // word-tracking effect below calls Range#getClientRects(), which forces
  // a synchronous layout -- landing right as a big nearby image is mid-
  // decode turns that into a real, audible hitch, not just a dropped
  // frame). `loading="lazy"` defers offscreen images' decode until they're
  // actually about to scroll into view instead of paying for all of them
  // upfront; `decoding="async"` keeps whichever ones do decode off the
  // main thread's critical path.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.decoding = "async";
    });
  }, [html]);

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
    //
    // Resolving every position is pure string work (resolveTextPosition
    // only touches fullText), so it's done for all of them up front and
    // sorted by start -- that's what lets the single createOffsetPointFinder
    // below walk the container's text nodes just once for the whole
    // article's highlights instead of restarting from the top for each one
    // (see its own doc comment for why that used to dominate this pass's
    // cost on a heavily-highlighted article).
    const resolved: { highlight: (typeof highlights)[number]; start: number; end: number }[] = [];
    for (const highlight of highlights) {
      // This renderer only knows how to place "text" positions -- a PDF/EPUB
      // highlight has no meaning inside an HTML article's DOM.
      if (highlight.position.type !== "text") continue;
      const resolution = resolveTextPosition(fullText, highlight.position);
      if (resolution.status === "unresolved") continue;
      resolved.push({ highlight, start: resolution.start, end: resolution.end });
    }
    resolved.sort((a, b) => a.start - b.start);

    const pointFor = createOffsetPointFinder(container);
    const marksByHighlight = new Map<string, HTMLElement[]>();
    for (const { highlight, start, end } of resolved) {
      const startPoint = pointFor(start);
      const endPoint = pointFor(end);
      if (!startPoint || !endPoint) continue;
      const range = document.createRange();
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);

      const marks = wrapRangeInElements(range, () => {
        const mark = document.createElement("mark");
        mark.dataset.highlightId = highlight.id;
        mark.className = "cursor-pointer rounded-[3px] text-inherit";
        applyHighlightColor(mark, highlight.color);
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
      // A real control, not decoration: it was mouse-only, so a note written
      // on a highlight could not be read back without a pointer. role +
      // tabindex make it reachable and announced; handleContainerKeyDown
      // below is what makes Enter/Space actually open it. The title is its
      // accessible name.
      pill.setAttribute("role", "button");
      pill.tabIndex = 0;
      pill.innerHTML =
        '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12M2 8h8M2 13h5"/></svg>';
      marks[marks.length - 1].after(pill);
    }
  }, [highlights, html]);

  // Read-along, chunk-level: a separate effect from the highlight-marks
  // pass above -- this fires far more often (every TTS chunk, every few
  // seconds) and has nothing to do with the highlight list, so tying it to
  // that effect would mean needlessly re-resolving every real highlight's
  // position on every single sentence read aloud. Only locates the chunk
  // and moves the section left-bar + scroll -- word-level highlighting
  // itself is the effect below, since it needs to run much more often than
  // this one does and shouldn't pay this effect's whole-document search
  // cost every time.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only a real stop (readingChunkText itself going null -- playback
    // ended or was stopped) clears the bar outright. A failed lookup below
    // (the chunk's whitespace-normalized text not found verbatim in the
    // DOM, or an offset that doesn't resolve to a real point) used to clear
    // it here unconditionally too, before ever finding out whether a
    // replacement existed -- confirmed by hand this was the other real
    // cause of the bar intermittently vanishing mid-read: a rare, one-off
    // lookup miss doesn't mean there's nothing to show, it means this
    // particular chunk's position couldn't be freshly determined. Leaving
    // the previous section highlighted through a miss like that is a
    // strictly better outcome than the bar disappearing -- a slightly
    // stale indicator instead of no indicator at all.
    if (!readingChunkText) {
      if (activeSectionElRef.current) {
        activeSectionElRef.current.classList.remove("reading-section-active");
        activeSectionElRef.current = null;
      }
      chunkOffsetMapRef.current = null;
      return;
    }

    const fullText = plainTextOf(container);
    // Chunks are built by toSafeTextChunks (kokoro-tts.ts), which
    // deliberately collapses newlines/runs of whitespace into single
    // spaces while accumulating sentences into a chunk -- necessary there
    // (real article text, especially infobox/taxonomy content, has tons of
    // short newline-separated fragments that need gluing into normal-sized
    // chunks, see that function's own comment), but it means a plain exact
    // substring match against this container's real, un-normalized
    // plainTextOf() often fails on whitespace alone even though the actual
    // words match. Searching in a whitespace-normalized copy of both
    // strings and mapping the found offset back to the real string's
    // offsets (via `map`, built alongside the normalization) fixes that
    // without needing to touch the DOM text itself -- and doubles as the
    // word-level effect's own O(1) offset translation (readingWordRange's
    // offsets are relative to readingChunkText, which is itself already
    // whitespace-normalized by the chunker, i.e. the same coordinate space
    // as `normalized` here).
    let normalized = "";
    const map: number[] = []; // map[i] = fullText's real offset of normalized[i]
    let lastWasSpace = true; // treat leading whitespace as already "collapsed"
    for (let i = 0; i < fullText.length; i++) {
      const isSpace = /\s/.test(fullText[i]);
      if (isSpace) {
        if (lastWasSpace) continue;
        normalized += " ";
        map.push(i);
        lastWasSpace = true;
      } else {
        normalized += fullText[i];
        map.push(i);
        lastWasSpace = false;
      }
    }
    const normalizedChunk = readingChunkText.replace(/\s+/g, " ").trim();

    const normalizedStart = normalized.indexOf(normalizedChunk);
    if (normalizedStart === -1) return;
    const start = map[normalizedStart];
    // map[] only has entries up to normalized.length - 1 -- the end offset
    // is exclusive, so it needs the *next* character's real position, one
    // past the last matched normalized character.
    const normalizedEnd = normalizedStart + normalizedChunk.length;
    const end = normalizedEnd < map.length ? map[normalizedEnd] : fullText.length;

    chunkOffsetMapRef.current = { map, normalizedChunkStart: normalizedStart };

    const pointFor = createOffsetPointFinder(container);
    const startPoint = pointFor(start);
    const endPoint = pointFor(end);
    if (!startPoint || !endPoint) return;

    // nearestSectionEl now always resolves to *something* as long as the
    // point is inside the container (see its own comment) -- the missing
    // case worth guarding is a new chunk landing back in the *same*
    // section an earlier chunk already highlighted (common for a longer
    // paragraph spanning several chunks), where re-adding the class and
    // re-triggering scrollIntoView would just be a redundant, jumpy no-op.
    const sectionEl = nearestSectionEl(sectionAnchorNode(startPoint, container), container);
    if (sectionEl && sectionEl !== activeSectionElRef.current) {
      activeSectionElRef.current?.classList.remove("reading-section-active");
      sectionEl.classList.add("reading-section-active");
      activeSectionElRef.current = sectionEl;
      sectionEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [readingChunkText]);

  // Read-along, word-level: fires several times a second while playing
  // (driven by the audio element's own timeupdate, see
  // tts-player-provider.tsx), so unlike the chunk-level effect above this
  // never touches the DOM's actual text nodes -- wrapping/unwrapping a
  // <mark> that often risks fighting itself (removing the previous word's
  // wrapper calls Node#normalize(), which can merge/detach text nodes a
  // fresh lookup then can't find). Range#getClientRects() is read-only:
  // it's used purely to compute where to draw a separate, absolutely-
  // positioned overlay box, never to mutate the article's own markup.
  useEffect(() => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    const chunkInfo = chunkOffsetMapRef.current;
    if (!container || !wrapper || !chunkInfo || !readingWordRange) {
      setWordRects([]);
      return;
    }

    const { map, normalizedChunkStart } = chunkInfo;
    const normalizedStart = normalizedChunkStart + readingWordRange.start;
    const normalizedEnd = normalizedChunkStart + readingWordRange.end;
    if (normalizedStart < 0 || normalizedStart >= map.length) {
      setWordRects([]);
      return;
    }
    const realStart = map[normalizedStart];
    const realEnd = normalizedEnd < map.length ? map[normalizedEnd] : (map[map.length - 1] ?? realStart) + 1;

    const range = rangeForTextOffsets(container, realStart, realEnd);
    if (!range) {
      setWordRects([]);
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        top: r.top - wrapperRect.top,
        left: r.left - wrapperRect.left,
        width: r.width,
        height: r.height,
      }));
    setWordRects(rects);
  }, [readingWordRange]);

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

  function openManagePopoverFor(marker: HTMLElement | null) {
    if (!marker) return;
    const highlight = highlights.find((h) => h.id === marker.dataset.highlightId);
    if (!highlight) return;
    setManaging({ highlight, rect: marker.getBoundingClientRect() });
  }

  function handleContainerClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    openManagePopoverFor(target.closest<HTMLElement>("mark[data-highlight-id], .note-pill[data-highlight-id]"));
  }

  // Only the note pills are focusable (see where they're built above), so
  // this only ever fires for them -- the marks themselves are inline article
  // text and are deliberately left as they are.
  function handleContainerKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const pill = (e.target as HTMLElement).closest<HTMLElement>(".note-pill[data-highlight-id]");
    if (!pill) return;
    e.preventDefault();
    openManagePopoverFor(pill);
  }

  const { fontSize, lineHeight } = SIZE_STYLE[size];

  // React only skips re-touching a dangerouslySetInnerHTML node when the
  // *object reference* it's given is stable across renders -- a fresh
  // `{ __html: html }` literal every render makes React re-apply innerHTML
  // (and wipe the marks/pills injected above) on every unrelated re-render.
  //
  // Sanitized here rather than trusted from storage. The API sanitizes on
  // save too, but this is the only point that is true for *every* article:
  // ones saved before that existed, and local/anonymous ones that never went
  // through the API at all. Readability strips <script> and looks like it
  // has handled this -- it passes <img onerror>, <svg onload> and
  // <details ontoggle> straight through, which with the access token in
  // localStorage is account takeover from opening a saved link.
  const dangerousHtml = useMemo(() => ({ __html: sanitizeArticleHtml(html) }), [html]);

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={containerRef}
        data-article-content
        onMouseUp={handleMouseUp}
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
        className="font-serif text-ink [&_p]:mb-5 [&_em]:italic [&_strong]:font-semibold"
        style={{ fontSize, lineHeight }}
        dangerouslySetInnerHTML={dangerousHtml}
      />
      {/* Read-along word cursor -- a read-only overlay (see the word-level
          effect above for why this doesn't wrap the text itself), not part
          of the reading flow, so it's inert to selection/clicks. */}
      {wordRects.map((r, i) => (
        <div
          key={i}
          data-reading-word
          aria-hidden="true"
          className="reading-word pointer-events-none absolute rounded-[3px]"
          style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
        />
      ))}
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
