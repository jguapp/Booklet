import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdfText, isTextSparse } from "../services/pdf-extraction.js";

/**
 * pdf-extraction had no unit coverage at all, which is how the leak below
 * survived: every getDocument() spins up its own pdf.js worker, and nothing
 * released it -- not on success, and not on the "couldn't find any
 * extractable text" throw, which is the path every scanned PDF takes.
 *
 * A worker count is not directly observable from here, so the guard is the
 * thing a missing teardown actually breaks: doing it repeatedly. These run
 * the real extractor against a real PDF rather than a mock, since the bug was
 * in the lifecycle of a real pdf.js object.
 */

const dir = path.dirname(fileURLToPath(import.meta.url));

async function sample(): Promise<Uint8Array> {
  // A fresh copy per call on purpose: pdf.js may take ownership of the buffer
  // it is handed, so sharing one between extractions would test that rather
  // than what these cases are about.
  return new Uint8Array(await readFile(path.join(dir, "fixtures", "sample.pdf")));
}

describe("extractPdfText", () => {
  it("pulls the text, a reading time and a cover out of a real PDF", async () => {
    const result = await extractPdfText(await sample());
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.textSource).toBe("NATIVE");
    expect(result.readingTimeEstimate).toBeGreaterThanOrEqual(1);
    // Rendered from page 1, so it is a data URI rather than a remote URL.
    expect(result.coverImageUrl === null || result.coverImageUrl.startsWith("data:image/")).toBe(true);
  }, 60_000);

  it("survives being called repeatedly", async () => {
    // Each iteration used to strand a worker and its document. Five in a row
    // is not a load test -- it is the smallest thing that fails if teardown
    // is missing *and* pdf.js starts refusing to allocate.
    for (let i = 0; i < 5; i++) {
      const result = await extractPdfText(await sample());
      expect(result.text.trim().length, `extraction ${i + 1} came back empty`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("rejects a file that isn't a PDF instead of throwing something raw", async () => {
    // The failure path also has to release its loading task; a document that
    // fails during init has usually still spawned a worker.
    const notAPdf = new Uint8Array(Buffer.from("this is plainly not a PDF"));
    await expect(extractPdfText(notAPdf)).rejects.toThrow();
  }, 30_000);
});

describe("isTextSparse", () => {
  it("treats an empty or near-empty text layer as scanned", () => {
    expect(isTextSparse(["", "", ""])).toBe(true);
    expect(isTextSparse(["a", "b"])).toBe(true);
  });

  it("does not send a real text layer to OCR", () => {
    expect(isTextSparse([("word ".repeat(50)), ("word ".repeat(50))])).toBe(false);
  });

  it("says no rather than dividing by zero when there are no pages", () => {
    expect(isTextSparse([])).toBe(false);
  });
});
