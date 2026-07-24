import type { TextPosition } from "./types/highlight-position";

const CONTEXT_LENGTH = 32;

/**
 * Derive a `text`-type highlight position from a plain-text offset range.
 * `fullText` must be the same string the offsets will later be resolved against
 * (Article.extractedText). Only meaningful for HTML articles -- PDF/EPUB
 * positions are constructed directly from PDF.js/epub.js APIs, not this.
 */
export function computeTextPosition(fullText: string, start: number, end: number): TextPosition {
  return {
    type: "text",
    exact: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: fullText.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
  };
}

export type AnchorResolution =
  | { status: "resolved"; start: number; end: number; driftedOffsets: boolean }
  | { status: "unresolved" };

/**
 * Re-find a `text`-type highlight's range inside the current extractedText.
 * PDF/EPUB positions don't need this: they're anchored against an immutable
 * uploaded file, so they either resolve directly or fail outright -- there's
 * no drift to search for the way a re-extracted web article can have.
 *
 * 1. Fast path: trust the stored offsets if the text there still matches exactly.
 * 2. Search for prefix+exact+suffix (disambiguates repeated phrases).
 * 3. Fall back to a bare search for `exact`, picking the match closest to the
 *    original offset when there's more than one.
 * 4. Give up -- caller should render the highlight as unresolved rather than
 *    guessing at a wrong position.
 */
export function resolveTextPosition(fullText: string, position: TextPosition): AnchorResolution {
  const { exact, prefix, suffix, start, end } = position;

  if (fullText.slice(start, end) === exact) {
    return { status: "resolved", start, end, driftedOffsets: false };
  }

  const withContext = prefix + exact + suffix;
  const contextMatches = findAllIndexes(fullText, withContext);
  if (contextMatches.length > 0) {
    const matchStart = closestTo(contextMatches, start) + prefix.length;
    return {
      status: "resolved",
      start: matchStart,
      end: matchStart + exact.length,
      driftedOffsets: true,
    };
  }

  if (exact.length > 0) {
    const bareMatches = findAllIndexes(fullText, exact);
    if (bareMatches.length > 0) {
      const matchStart = closestTo(bareMatches, start);
      return {
        status: "resolved",
        start: matchStart,
        end: matchStart + exact.length,
        driftedOffsets: true,
      };
    }
  }

  return { status: "unresolved" };
}

function findAllIndexes(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const indexes: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    indexes.push(i);
    from = i + 1;
  }
  return indexes;
}

function closestTo(candidates: number[], target: number): number {
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best,
  );
}
