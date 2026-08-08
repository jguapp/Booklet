import type { Highlight } from "@booklet/shared";
import { compareCfi } from "./cfi";

/** Where a highlight sits within its own article, in reading order --
 * unlike `createdAt`, which only reflects when it happened to be made
 * (revisiting an earlier chapter after a later one makes createdAt-order
 * jump around). */
export function comparePositionInArticle(a: Highlight, b: Highlight): number {
  const posA = a.position;
  const posB = b.position;
  if (posA.type === "text" && posB.type === "text") {
    return posA.start - posB.start;
  }
  if (posA.type === "pdf" && posB.type === "pdf") {
    if (posA.pageNumber !== posB.pageNumber) return posA.pageNumber - posB.pageNumber;
    // Same page -- PDF user-space y increases upward (bottom-left origin),
    // so a *larger* y is higher on the page, i.e. read first. Take the
    // topmost (max) y across each highlight's rects as its start point.
    const topOf = (rects: { y: number }[]) => (rects.length > 0 ? Math.max(...rects.map((r) => r.y)) : 0);
    return topOf(posB.rects) - topOf(posA.rects);
  }
  if (posA.type === "epub" && posB.type === "epub") {
    return compareCfi(posA.cfi, posB.cfi);
  }
  // Different position types (shouldn't happen within one article) --
  // stable no-op rather than an arbitrary ordering.
  return 0;
}
