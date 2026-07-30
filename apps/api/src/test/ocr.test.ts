import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { isTextSparse } from "../services/pdf-extraction.js";
import { OcrWorkerPool } from "../services/ocr-service.js";

describe("isTextSparse", () => {
  it("is not sparse when pages have real amounts of text", () => {
    const realPageText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5);
    expect(isTextSparse([realPageText, realPageText])).toBe(false);
  });

  it("is sparse for a scanned PDF's empty pages", () => {
    expect(isTextSparse(["", "", ""])).toBe(true);
  });

  it("is sparse for pages with only trace/noise text (a few stray characters)", () => {
    expect(isTextSparse(["12", "", "a"])).toBe(true);
  });

  it("treats no pages at all as not sparse (nothing to fall back on)", () => {
    expect(isTextSparse([])).toBe(false);
  });
});

// Real Tesseract recognition, not mocked -- the actual risk in this feature
// is "does OCR work at all in this environment" (native canvas bindings,
// WASM loading, trained-data fetch), which a mock would hide entirely.
// Renders text directly rather than round-tripping through a real PDF file
// (no PDF-construction library is a dependency here) -- this still
// exercises the exact same recognize() call pdf-extraction.ts makes
// against a rendered page image, just without the PDF-parsing layer
// around it.
describe("OcrWorkerPool", () => {
  it(
    "recognizes real rendered text from an image",
    async () => {
      const canvas = createCanvas(400, 100);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 400, 100);
      ctx.fillStyle = "black";
      ctx.font = "32px sans-serif";
      ctx.fillText("Hello Booklet", 20, 60);

      const pool = new OcrWorkerPool();
      try {
        const text = await pool.recognize(canvas.toBuffer("image/png"));
        expect(text.toLowerCase()).toContain("hello");
        expect(text.toLowerCase()).toContain("booklet");
      } finally {
        await pool.terminate();
      }
    },
    30_000, // first run downloads/loads the trained-data model
  );
});
