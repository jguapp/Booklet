import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { isTextSparse } from "../services/pdf-extraction.js";
import { OcrWorkerPool, getSharedOcrPool } from "../services/ocr-service.js";

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
/** tesseract.js fetches its ~15MB trained data from a CDN on first use, so
 * this test is only meaningful where that CDN is reachable. Probing and
 * skipping, rather than letting it fail, is the difference between a verify
 * run that stays trustworthy offline and one that is permanently red -- and a
 * permanently red check is one people learn to ignore. The failure path is
 * covered without any network at all in ocr-failure.test.ts, so skipping here
 * loses only the "does real OCR work in this environment" signal, which is
 * exactly the thing that cannot be answered without the network anyway. */
async function trainedDataReachable(): Promise<boolean> {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe("OcrWorkerPool", () => {
  it(
    "recognizes real rendered text from an image",
    async (test) => {
      if (!(await trainedDataReachable())) {
        test.skip("tesseract trained-data CDN unreachable -- see ocr-failure.test.ts for the offline coverage");
        return;
      }
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

describe("getSharedOcrPool", () => {
  // The actual bug this guards: pdf-extraction.ts used to create a fresh
  // OcrWorkerPool per request and terminate it at the end, paying Tesseract's
  // multi-second worker-startup cost (loading the WASM engine + trained
  // data) on every single OCR'd upload instead of once per process. An
  // identity check is deliberately what this asserts, not a timing
  // comparison -- timing-based tests are exactly the kind that flake under
  // CI/system load without actually proving the thing that matters, which is
  // that every caller gets the same, already-warm pool.
  it("returns the same pool instance across calls, not a fresh one each time", () => {
    expect(getSharedOcrPool()).toBe(getSharedOcrPool());
  });
});
