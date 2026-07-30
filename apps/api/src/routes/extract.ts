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
const EXTRACT_LIMIT = { max: 20, timeWindow: "10 minutes" };

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
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "no_file", message: "No file was uploaded." });

      const ext = file.filename.toLowerCase().split(".").pop();
      if (ext !== "pdf" && ext !== "epub") {
        return reply.code(400).send({ error: "unsupported_type", message: "Only .pdf and .epub files are supported." });
      }

      const buffer = await file.toBuffer();
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
          ...(ext === "pdf" ? { textSource: (result as PdfExtractionResult).textSource } : {}),
        };
        return reply.send(body);
      } catch (err) {
        const message =
          err instanceof PdfExtractionError || err instanceof EpubExtractionError ? err.message : "Extraction failed.";
        return reply.code(422).send({ error: "extraction_failed", message });
      }
    },
  );
}
