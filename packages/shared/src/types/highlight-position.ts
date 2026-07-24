/**
 * W3C-style TextQuote+TextPosition selector against Article.extractedText.
 * The only position type that needs drift-tolerant re-resolution: the
 * underlying extractedText can theoretically change (re-extraction, a
 * Readability version bump), so `exact`/`prefix`/`suffix` back up
 * `start`/`end` when they drift. See highlight-anchor.ts.
 */
export interface TextPosition {
  type: "text";
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Page + bounding rects, in the PDF's own unrotated user-space units --
 * never raw screen/CSS pixels, so a highlight survives the user changing
 * zoom level. A highlight cannot span a page break (matches Chrome's PDF
 * viewer, Acrobat, and Kindle's PDF mode). Anchored against an uploaded,
 * immutable file, so unlike `text` there's no drift to search for: it
 * either resolves or it doesn't.
 */
export interface PdfPosition {
  type: "pdf";
  pageNumber: number; // 1-indexed
  text: string; // page-local text, for re-search if a rect ever fails to line up
  prefix: string;
  suffix: string;
  rects: PdfRect[];
}

/**
 * A CFI (Canonical Fragment Identifier) range -- a single string can encode
 * both endpoints via its comma syntax. Structural, not offset-based, so it
 * doesn't drift the way text offsets do. Anchored against an uploaded,
 * immutable file, same as `pdf`.
 */
export interface EpubPosition {
  type: "epub";
  cfi: string;
}

export type HighlightPosition = TextPosition | PdfPosition | EpubPosition;
