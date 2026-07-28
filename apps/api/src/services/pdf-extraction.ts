// The "legacy" build is pdfjs-dist's supported entry point for Node --
// the default build assumes a browser (Worker, DOM canvas, etc).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export class PdfExtractionError extends Error {}

export interface PdfExtractionResult {
  title: string | null;
  text: string;
  readingTimeEstimate: number;
}

const WORDS_PER_MINUTE = 200;

export async function extractPdfText(data: Uint8Array): Promise<PdfExtractionResult> {
  let doc;
  try {
    doc = await getDocument({ data, useSystemFonts: true }).promise;
  } catch (err) {
    throw new PdfExtractionError(err instanceof Error ? err.message : "Failed to open that PDF.");
  }

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pageTexts.push(pageText.trim());
  }

  const metadata = await doc.getMetadata().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTitle = (metadata?.info as any)?.Title;
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;

  const text = pageTexts.join("\n\n");
  if (!text.trim()) {
    throw new PdfExtractionError("Couldn't find any extractable text in that PDF (it may be scanned images).");
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const readingTimeEstimate = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

  return { title, text, readingTimeEstimate };
}
