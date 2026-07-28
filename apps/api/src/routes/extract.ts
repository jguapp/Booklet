import type { FastifyInstance } from "fastify";
import type { CreateArticleRequest, ExtractedContent } from "@booklet/shared";
import { ExtractionError, fetchAndExtract } from "../services/extraction-service.js";

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
}
