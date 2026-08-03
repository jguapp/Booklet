/**
 * DOM <-> plain-text offset bridging for the highlight anchoring scheme.
 * The plain-text coordinate space here must match Article.extractedText
 * (both are "concatenated textContent in document order", the same
 * definition the browser itself uses for Range#toString and Node#textContent).
 */

export function plainTextOf(root: HTMLElement): string {
  return root.textContent ?? "";
}

export function textOffsetsForRange(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } {
  const toStart = document.createRange();
  toStart.selectNodeContents(root);
  toStart.setEnd(range.startContainer, range.startOffset);

  const toEnd = document.createRange();
  toEnd.selectNodeContents(root);
  toEnd.setEnd(range.endContainer, range.endOffset);

  return { start: toStart.toString().length, end: toEnd.toString().length };
}

function pointForTextOffset(
  root: HTMLElement,
  targetOffset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (consumed + len >= targetOffset) {
      return { node, offset: targetOffset - consumed };
    }
    consumed += len;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

export function rangeForTextOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const startPoint = pointForTextOffset(root, start);
  const endPoint = pointForTextOffset(root, end);
  if (!startPoint || !endPoint) return null;

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

/**
 * Same offset->DOM-point lookup as rangeForTextOffsets, but shared across
 * many lookups against the same root: article-content.tsx used to call
 * rangeForTextOffsets once per highlight, and each call walked the whole
 * container from its very first text node -- fine for one highlight, but
 * O(highlights x document size) for a whole article's worth of them, which
 * is what actually made opening a heavily-highlighted article slow.
 *
 * Call sites are expected to resolve every highlight's offsets first (pure
 * string ops against plainTextOf's output, no DOM), sort by start ascending,
 * then look them up through the SAME finder in that order -- the walker
 * then only ever advances, one pass over the container's text nodes total,
 * however many highlights there are. Two highlights can still overlap
 * (nothing stops a user selecting text that's already highlighted), so a
 * later-by-start highlight's own end can still fall behind where the walk
 * already is -- rather than returning a bogus negative offset, this
 * restarts from the top for that one lookup instead. Worse than a single
 * forward pass, but never worse than the old per-lookup-from-scratch
 * behavior, and overlapping highlights are the exception, not the norm.
 */
export function createOffsetPointFinder(
  root: HTMLElement,
): (targetOffset: number) => { node: Text; offset: number } | null {
  let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let consumed = 0;

  return function pointFor(targetOffset: number) {
    if (targetOffset < consumed) {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      node = walker.nextNode() as Text | null;
      consumed = 0;
    }
    while (node) {
      const len = node.data.length;
      if (consumed + len >= targetOffset) {
        return { node, offset: targetOffset - consumed };
      }
      consumed += len;
      node = walker.nextNode() as Text | null;
    }
    return null;
  };
}

function textNodesIntersecting(root: HTMLElement, range: Range): Text[] {
  // Scoped to the range's own common ancestor rather than the whole
  // container -- for a highlight spanning a sentence or a paragraph (the
  // overwhelming common case), that's a small fraction of a whole article's
  // text nodes, not all of them. Text-node ancestor (start and end both
  // land in the same text node) has no element children of its own to walk,
  // so it can only ever intersect itself.
  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) return [ancestor as Text];
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (range.intersectsNode(node)) nodes.push(node);
    node = walker.nextNode() as Text | null;
  }
  return nodes;
}

/**
 * Wrap `range` in one or more elements (one per intersected text node --
 * Range#surroundContents refuses to span partial element boundaries, so a
 * highlight crossing e.g. a <p> or an <em> becomes several marks, not one).
 */
export function wrapRangeInElements(
  root: HTMLElement,
  range: Range,
  createWrapper: () => HTMLElement,
): HTMLElement[] {
  const nodes = textNodesIntersecting(root, range);
  const wrappers: HTMLElement[] = [];

  for (const node of nodes) {
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    if (node === range.startContainer) nodeRange.setStart(node, range.startOffset);
    if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset);
    if (nodeRange.collapsed) continue;

    const wrapper = createWrapper();
    nodeRange.surroundContents(wrapper);
    wrappers.push(wrapper);
  }

  return wrappers;
}
