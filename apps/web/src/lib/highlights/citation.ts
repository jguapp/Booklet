import type { Highlight } from "@booklet/shared";
import { EpubCFI } from "epubjs";

/** "p. 42" for a PDF highlight (the page number is already captured on
 * every PdfPosition, just never surfaced anywhere). "Section 4" for an
 * EPUB highlight, from the CFI's own spine-position -- resolving to a real
 * chapter *title* would need the book's table of contents, which means
 * opening the actual EPUB file; spine position is derivable from the CFI
 * string alone, so it's free to show everywhere a highlight is listed
 * (this page, the reader, exports) without that per-render file I/O cost.
 * null for HTML highlights -- character offsets aren't a citation anyone
 * reads. */
export function highlightCitation(highlight: Highlight): string | null {
  const position = highlight.position;
  if (position.type === "pdf") return `p. ${position.pageNumber}`;
  if (position.type === "epub") {
    const spinePos = new EpubCFI(position.cfi).spinePos;
    return typeof spinePos === "number" && spinePos >= 0 ? `Section ${spinePos + 1}` : null;
  }
  return null;
}
