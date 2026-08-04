// The "legacy" build is pdfjs-dist's supported entry point for Node --
// the default build assumes a browser (Worker, DOM canvas, etc).
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { getSharedOcrPool } from "./ocr-service.js";

export class PdfExtractionError extends Error {}

export interface PdfExtractionResult {
  title: string | null;
  text: string;
  readingTimeEstimate: number;
  /** "OCR" when the text layer was empty/unusable (a scanned PDF) and this
   * came from image recognition instead -- the reader shows a notice for
   * this case, since OCR'd text can contain real errors a native text
   * layer never would. */
  textSource: "NATIVE" | "OCR";
  /** data: URI thumbnail of page 1, for the library card. Null if
   * rendering it failed -- cosmetic, never worth failing the whole
   * upload over. */
  coverImageUrl: string | null;
}

const WORDS_PER_MINUTE = 200;
// A genuinely scanned book can be hundreds of pages; OCR runs synchronously
// within the upload request today (no background-job infra exists yet --
// see the issue this shipped from), so this caps worst-case request
// latency rather than leaving it unbounded. Text beyond this page count is
// simply not recovered -- a real, known limitation, not a silent one (the
// truncation is visible in the returned text length vs page count).
const MAX_OCR_PAGES = 20;
// A scale of 1 renders at the PDF's own point size (roughly 72 DPI) --
// too low-resolution for Tesseract to read reliably. ~200 DPI is a
// reasonable floor for OCR accuracy without ballooning render time.
const OCR_RENDER_SCALE = 2.5;
// A library card thumbnail just needs to be recognizable at a glance, not
// legible -- far lower resolution than the OCR render above, so it stays
// small (the cover loads on every library card, not just this article's
// own reader view) and cheap to generate.
const COVER_RENDER_SCALE = 0.5;
const COVER_JPEG_QUALITY = 0.7;

export function isTextSparse(pageTexts: string[]): boolean {
  const totalChars = pageTexts.reduce((sum, t) => sum + t.length, 0);
  // A real text layer averages far more than this per page even on a
  // sparse page (a title page, a mostly-blank page); a scanned PDF's
  // "text layer" is either completely empty or just OCR garbage/noise
  // left over from a prior bad conversion.
  return pageTexts.length > 0 && totalChars / pageTexts.length < 20;
}

export async function extractPdfText(data: Uint8Array): Promise<PdfExtractionResult> {
  let doc;
  try {
    doc = await getDocument({ data, useSystemFonts: true }).promise;
  } catch (err) {
    throw new PdfExtractionError(err instanceof Error ? err.message : "Failed to open that PDF.");
  }

  const coverImageUrl = await renderCoverThumbnail(doc).catch(() => null);

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

  let textSource: "NATIVE" | "OCR" = "NATIVE";
  let finalPageTexts = pageTexts;

  if (isTextSparse(pageTexts)) {
    // Shared across requests -- see getSharedOcrPool's own comment. Never
    // terminated here: this is the whole point, an OCR'd upload after the
    // first one in this process's life shouldn't pay worker startup again.
    const ocrPool = getSharedOcrPool();
    const ocrPageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
    const ocrTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= ocrPageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      // pdf.js's render() wants a full CanvasRenderingContext2D; @napi-rs/
      // canvas's SKRSContext2D implements the same surface it actually
      // calls (fillRect, drawImage, path ops, etc.), close enough that
      // this cast is the standard way these two libraries are paired.
      // `canvas: null` opts into the canvasContext-only path (pdf.js
      // otherwise expects a real HTMLCanvasElement, which this isn't).
      await page.render({
        canvas: null,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const text = await ocrPool.recognize(canvas.toBuffer("image/png"));
      ocrTexts.push(text);
    }
    finalPageTexts = ocrTexts;
    textSource = "OCR";
  }

  const text = finalPageTexts.join("\n\n");
  if (!text.trim()) {
    throw new PdfExtractionError("Couldn't find any extractable text in that PDF (it may be scanned images).");
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const readingTimeEstimate = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

  return { title, text, readingTimeEstimate, textSource, coverImageUrl };
}

async function renderCoverThumbnail(doc: PDFDocumentProxy): Promise<string | null> {
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: COVER_RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({
    canvas: null,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return canvas.toDataURL("image/jpeg", COVER_JPEG_QUALITY);
}
