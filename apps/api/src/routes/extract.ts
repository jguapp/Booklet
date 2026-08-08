import type { FastifyInstance } from "fastify";
import type { CreateArticleRequest, ExtractedContent } from "@booklet/shared";
import { ExtractionError, fetchAndExtract } from "../services/extraction-service.js";
import { EpubExtractionError, extractEpubText } from "../services/epub-extraction.js";
import { PdfExtractionError, extractPdfText, type PdfExtractionResult } from "../services/pdf-extraction.js";

/**
 * Public (no auth) -- used by both signed-in clients (which then persist via
 * POST /api/articles) and fully local/anonymous clients, which save the
 * result straight into their own IndexedDB. Extraction itself doesn't touch
 * any user data, so there's nothing here that needs an account.
 */
// No auth gate means no per-user cost to being an open URL-fetcher --
// tighter than the API-wide default so it can't be used as a free proxy.
// Relaxed outside production: this route backs nearly every real e2e test
// in apps/web/e2e (every anonymous-mode "save a URL" goes through it), and
// 20/10min is exhausted almost immediately by the full suite -- CI's own
// test-web-e2e job has been failing on exactly this for a while, since it
// runs the real dev server (see ci.yml), not a mock.
const EXTRACT_LIMIT = {
  max: process.env.NODE_ENV === "production" ? 20 : 2000,
  timeWindow: "10 minutes",
};

/**
 * File extraction is far more expensive than URL extraction and is reachable
 * by anyone, so it gets bounds of its own.
 *
 * It has to stay unauthenticated: local/anonymous mode is a real product
 * feature, and a reader who never signs up still uploads books. Requiring an
 * account here would be the easy fix and would delete a feature.
 *
 * What makes it costly is not the request, it is what the request buys. A
 * PDF goes through pdf.js parsing plus rasterization of up to 20 pages at
 * 2.5x scale, and an EPUB is a zip that can decompress to far more than it
 * weighs. The API-wide multipart limit is 100MB, sized for an authenticated
 * user uploading a scanned book they own -- as an anonymous budget it means
 * a stranger can hand three cores a 100MB PDF for the cost of one request.
 *
 * Two bounds, because either alone is insufficient:
 *
 *   Size. 25MB covers essentially every real ebook (a text EPUB is single-
 *   digit MB; an image-heavy PDF rarely passes 20MB) while removing two
 *   orders of magnitude from the worst case. Signed-in uploads keep the
 *   100MB route, where the cost is attached to an account.
 *
 *   Concurrency. A rate limit bounds requests per window, not work in
 *   flight -- 20 requests inside one second is within the limit and is 20
 *   simultaneous parses. This caps how many can be *running*, so the TTS
 *   pool and ordinary reads keep their share of the CPU. Excess is refused
 *   with 503 rather than queued: a queue behind an expensive synchronous
 *   parse just converts refusal into timeout.
 */
const ANON_FILE_MAX_BYTES = 25 * 1024 * 1024;
const MAX_CONCURRENT_FILE_EXTRACTIONS = 2;
let inFlightFileExtractions = 0;

export async function registerExtractRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateArticleRequest }>(
    "/api/extract",
    { config: { rateLimit: EXTRACT_LIMIT } },
    async (request, reply) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !url.trim()) {
      return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
    }

    try {
      const extracted: ExtractedContent = await fetchAndExtract(url);
      return reply.send(extracted);
    } catch (err) {
      const message = err instanceof ExtractionError ? err.message : "Extraction failed.";
      return reply.code(422).send({ error: "extraction_failed", message });
    }
    },
  );

  /**
   * Same "extraction only, no persistence" contract as POST /api/extract,
   * for PDF/EPUB -- what lets local/anonymous mode support file uploads too:
   * the client does the round trip for extraction, then stores the result
   * (and the raw file) in its own IndexedDB, exactly like it already does
   * for URL saves.
   */
  app.post(
    "/api/extract-file",
    { config: { rateLimit: EXTRACT_LIMIT } },
    async (request, reply) => {
      // Checked before reading the body, so a refusal costs nothing.
      if (inFlightFileExtractions >= MAX_CONCURRENT_FILE_EXTRACTIONS) {
        return reply
          .code(503)
          .header("Retry-After", "10")
          .send({ error: "busy", message: "Too many file extractions in progress. Try again in a moment." });
      }

      const tooLarge = () =>
        reply.code(413).send({
          error: "file_too_large",
          message: `Files up to ${Math.floor(ANON_FILE_MAX_BYTES / (1024 * 1024))}MB can be extracted without an account.`,
        });

      const file = await request.file({ limits: { fileSize: ANON_FILE_MAX_BYTES } });
      if (!file) return reply.code(400).send({ error: "no_file", message: "No file was uploaded." });

      const ext = file.filename.toLowerCase().split(".").pop();
      if (ext !== "pdf" && ext !== "epub") {
        return reply.code(400).send({ error: "unsupported_type", message: "Only .pdf and .epub files are supported." });
      }

      // The size limit fires *here*, not at request.file(): the limit is
      // enforced as the stream is consumed, and request.file() only gives
      // you the handle. Catching it around the wrong call is why this looked
      // fixed while still returning the framework's bare
      // "request file too large" -- which contains no number, and the number
      // is the only part a reader can act on.
      //
      // The truncated check covers the same condition under
      // throwFileSizeLimit: false, where multipart silently hands back a
      // short buffer instead. That reaches pdf.js and fails as "not a valid
      // PDF", which is a confusing way to say "too big".
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return tooLarge();
        throw err;
      }
      if (file.file.truncated) return tooLarge();

      inFlightFileExtractions++;
      try {
        const result = ext === "pdf" ? await extractPdfText(new Uint8Array(buffer)) : await extractEpubText(buffer);
        const body: ExtractedContent = {
          title: result.title,
          author: null,
          siteName: null,
          excerpt: null,
          html: null,
          text: result.text,
          readingTimeEstimate: result.readingTimeEstimate,
          coverImageUrl: result.coverImageUrl,
          ...(ext === "pdf" ? { textSource: (result as PdfExtractionResult).textSource } : {}),
        };
        return reply.send(body);
      } catch (err) {
        const message =
          err instanceof PdfExtractionError || err instanceof EpubExtractionError ? err.message : "Extraction failed.";
        return reply.code(422).send({ error: "extraction_failed", message });
      } finally {
        // finally, not the end of try: an extractor that throws something
        // unexpected would otherwise leak a slot permanently, and two of
        // those take the route down for everyone with no way back short of
        // a restart.
        inFlightFileExtractions--;
      }
    },
  );
}
