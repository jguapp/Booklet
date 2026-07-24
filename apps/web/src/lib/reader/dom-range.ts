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

function textNodesIntersecting(root: HTMLElement, range: Range): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
