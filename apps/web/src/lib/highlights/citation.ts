import type { Highlight } from "@booklet/shared";
import { EpubCFI } from "epubjs";

/** "p. 42" for a PDF highlight (the page number is already captured on
 * every PdfPosition, just never surfaced anywhere). "Section 4" for an
 * EPUB highlight, from the CFI's own spine-position -- resolving to a real
 * chapter *title* would need the book's table of contents, which means
 * opening the actual EPUB file; spine position is derivable from the CFI
 * string alone, so it's free to show everywhere a highlight is listed
 * (this page, the reader, exports) without that per-render file I/O cost.
 * "Paragraph 4" for an HTML/text highlight -- counts `\n{2,}` boundaries
 * (the same paragraph-split convention text-to-html.ts already uses to turn
 * this same extractedText into <p> tags) up to the highlight's own start
 * offset. Approximate if extractedText has since drifted from what the
 * highlight actually anchors to (see highlight-anchor.ts), but cheap
 * (string ops only, no DOM) and close enough to locate a highlight by eye.
 * `extractedText` is optional -- callers that don't have the article loaded
 * (or a PDF/EPUB highlight, which doesn't need it) can omit it. */
export function highlightCitation(highlight: Highlight, extractedText?: string | null): string | null {
  const position = highlight.position;
  if (position.type === "pdf") return `p. ${position.pageNumber}`;
  if (position.type === "epub") {
    const spinePos = new EpubCFI(position.cfi).spinePos;
    return typeof spinePos === "number" && spinePos >= 0 ? `Section ${spinePos + 1}` : null;
  }
  if (position.type === "text") {
    if (!extractedText) return null;
    const boundariesBefore = extractedText.slice(0, position.start).match(/\n{2,}/g)?.length ?? 0;
    return `Paragraph ${boundariesBefore + 1}`;
  }
  return null;
}
