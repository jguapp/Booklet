/**
 * Maps between DOM Ranges on a live page and plain-text offsets.
 *
 * The offsets produced here are *not* the offsets the highlight will
 * ultimately resolve against: Booklet anchors highlights to
 * `Article.extractedText` (Readability's output), which is a different string
 * from the live page's text -- no nav, no ads, different whitespace. What
 * survives that gap is the TextQuote part (`exact` + surrounding context),
 * which packages/shared's `resolveTextPosition` searches for before it ever
 * trusts `start`/`end`. So offsets are a best-effort hint and the quote is
 * the real anchor; that's why capturing accurate context matters more here
 * than capturing accurate offsets.
 */

/** Matches CONTEXT_LENGTH in packages/shared/src/highlight-anchor.ts, so the
 * context we capture is the size that re-resolution expects to compare. */
const CONTEXT_LENGTH = 32;

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "SVG", "CANVAS"]);

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

interface MappedNode {
  node: Text;
  start: number;
  end: number;
}

export interface TextMap {
  text: string;
  nodes: MappedNode[];
}

function isEligible(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || !node.nodeValue) return false;
  if (SKIPPED_TAGS.has(parent.tagName)) return false;
  // Our own injected UI must never become part of the page's text, or the
  // floating bar's own label could end up inside a highlight's context.
  if (parent.closest("[data-booklet-ui]")) return false;
  return true;
}

/**
 * Flatten the page's visible text into one string, keeping a back-reference
 * from every character range to the text node it came from.
 */
export function buildTextMap(root: HTMLElement): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (isEligible(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });

  const nodes: MappedNode[] = [];
  let text = "";

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).nodeValue ?? "";
    nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }

  return { text, nodes };
}

function offsetOf(map: TextMap, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = map.nodes.find((n) => n.node === container);
    return entry ? entry.start + offset : null;
  }
  // A range endpoint can sit on an element (between children) rather than
  // inside a text node -- resolve it to the first mapped text node at or
  // after that child index.
  const child = container.childNodes[offset] ?? null;
  if (!child) {
    const last = map.nodes.filter((n) => container.contains(n.node)).pop();
    return last ? last.end : null;
  }
  const next = map.nodes.find((n) => n.node === child || child.contains(n.node));
  return next ? next.start : null;
}

/** Build the anchor a highlight is stored with, from a live selection Range. */
export function anchorFromRange(map: TextMap, range: Range): TextAnchor | null {
  const start = offsetOf(map, range.startContainer, range.startOffset);
  const end = offsetOf(map, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;

  const exact = map.text.slice(start, end);
  if (!exact.trim()) return null;

  return {
    exact,
    prefix: map.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: map.text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
  };
}

/** Turn a character range back into a DOM Range spanning the same text. */
function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  const startEntry = map.nodes.find((n) => start >= n.start && start < n.end);
  const endEntry = map.nodes.find((n) => end > n.start && end <= n.end);
  if (!startEntry || !endEntry) return null;

  const range = document.createRange();
  range.setStart(startEntry.node, start - startEntry.start);
  range.setEnd(endEntry.node, end - endEntry.start);
  return range;
}

/**
 * Re-find a stored anchor in the current page. Same ladder as
 * packages/shared's `resolveTextPosition`, for the same reason: offsets go
 * stale (a re-render, an expanded comment thread, an injected ad) while the
 * quoted text plus its context usually doesn't.
 */
export function findAnchor(map: TextMap, anchor: TextAnchor): Range | null {
  if (map.text.slice(anchor.start, anchor.end) === anchor.exact) {
    return rangeFromOffsets(map, anchor.start, anchor.end);
  }

  const withContext = anchor.prefix + anchor.exact + anchor.suffix;
  const contextAt = closestIndexOf(map.text, withContext, anchor.start);
  if (contextAt !== null) {
    const at = contextAt + anchor.prefix.length;
    return rangeFromOffsets(map, at, at + anchor.exact.length);
  }

  const bareAt = closestIndexOf(map.text, anchor.exact, anchor.start);
  if (bareAt !== null) return rangeFromOffsets(map, bareAt, bareAt + anchor.exact.length);

  return null;
}

function closestIndexOf(haystack: string, needle: string, target: number): number | null {
  if (!needle) return null;
  let best: number | null = null;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (best === null || Math.abs(i - target) < Math.abs(best - target)) best = i;
  }
  return best;
}

/**
 * Wrap every text node the range covers in its own <mark>. Splitting per node
 * rather than `surroundContents` because a real selection routinely crosses
 * element boundaries (a link mid-sentence, a <em>), which `surroundContents`
 * refuses outright.
 */
export function paintRange(range: Range, id: string, className: string): HTMLElement[] {
  const covered: { node: Text; start: number; end: number }[] = [];

  const walker = document.createTreeWalker(
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? (range.commonAncestorContainer.parentNode as Node)
      : range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (node) => (isEligible(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) },
  );

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!range.intersectsNode(text)) continue;
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.length;
    if (start < end) covered.push({ node: text, start, end });
  }

  // Collect first, mutate after -- splitText() rewrites the tree the walker
  // is standing in.
  return covered.map(({ node, start, end }) => {
    const middle = start > 0 ? node.splitText(start) : node;
    if (end - start < middle.length) middle.splitText(end - start);

    const mark = document.createElement("mark");
    mark.className = className;
    mark.dataset.bookletHighlightId = id;
    middle.replaceWith(mark);
    mark.appendChild(middle);
    return mark;
  });
}

/** Unwrap a highlight's <mark>s, putting the page back exactly as it was. */
export function unpaint(id: string): void {
  for (const mark of document.querySelectorAll(`mark[data-booklet-highlight-id="${CSS.escape(id)}"]`)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    // Re-join the text nodes splitText() left behind, so repeated
    // highlight/unhighlight cycles don't shred the DOM into fragments.
    parent.normalize();
  }
}
