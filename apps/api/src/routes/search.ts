import type { FastifyInstance } from "fastify";
import type { SearchResponse } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { toSummary } from "./articles.js";
import { toHighlight } from "./highlights.js";

const RESULT_LIMIT = 25;

/**
 * Plain case-insensitive `contains` across a handful of text columns --
 * not Postgres tsvector/GIN. Simpler, and consistent with the local/
 * anonymous-mode search (plain substring matching over IndexedDB, which
 * has no full-text index at all) rather than giving signed-in users
 * relevance-ranked results local mode can't match. Fine at this app's
 * actual scale (one person's library); a tsvector column + GIN index is
 * the natural upgrade if that stops being true.
 */
export async function registerSearchRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/search", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { q?: string };
    const q = (query.q ?? "").trim();
    if (!q) {
      const body: SearchResponse = { articles: [], highlights: [] };
      return reply.send(body);
    }

    const userId = request.userId!;
    const contains = { contains: q, mode: "insensitive" as const };

    const [articleRows, highlightRows] = await Promise.all([
      prisma.article.findMany({
        where: {
          userId,
          OR: [
            { title: contains },
            { excerpt: contains },
            { author: contains },
            { siteName: contains },
            { extractedText: contains },
            { tags: { has: q } },
          ],
        },
        orderBy: [{ savedAt: "desc" }, { id: "desc" }],
        take: RESULT_LIMIT,
      }),
      prisma.highlight.findMany({
        where: {
          userId,
          OR: [{ selectedText: contains }, { annotation: { noteText: contains } }],
        },
        include: { annotation: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: RESULT_LIMIT,
      }),
    ]);

    const body: SearchResponse = {
      articles: articleRows.map(toSummary),
      highlights: highlightRows.map(toHighlight),
    };
    return reply.send(body);
  });
}
