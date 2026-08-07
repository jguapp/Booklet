import type { FastifyInstance } from "fastify";
import { Prisma } from "../generated/prisma/client.js";
import type { SearchResponse } from "@booklet/shared";
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { toSummary } from "./articles.js";
import { toHighlight } from "./highlights.js";

const RESULT_LIMIT = 25;

/**
 * Ranked full-text search (#155), replacing the plain case-insensitive
 * `contains` this route used to do.
 *
 * That earlier version was a deliberate choice, not an oversight: Postgres
 * tsvector was rejected precisely because local/anonymous mode had no
 * equivalent, and giving signed-in users better search than signed-out users
 * contradicts this app's "everything behaves the same either way" principle.
 * What changed is the answer to that objection -- local mode got a real index
 * of its own (apps/web/src/lib/data/search.ts) rather than the server being
 * held back to match it.
 *
 * Ranking, stemming and multi-word handling now come from Postgres:
 *
 * - The match runs against Article.searchVector, a GENERATED ... STORED
 *   column with weights A-D (title down to body text) -- see the migration.
 *   A title hit therefore outranks a passing mention in a long body, which is
 *   the ordering a reader expects and the old savedAt ordering could not give.
 * - websearch_to_tsquery, not plainto_tsquery: it treats a bare multi-word
 *   query as AND (so "flow state attention" no longer requires those three
 *   words to be adjacent, which is what made it match nothing before), while
 *   also understanding quoted phrases, OR, and -exclusion for free.
 * - Stemming is the 'english' config's, so "running" finds "runs".
 *
 * Two things stay outside the tsvector on purpose. Tags are matched as exact
 * array elements, because a tag is a label rather than prose -- and because
 * array_to_string is only STABLE, so including them would make the generated
 * column illegal anyway. Highlights keep their own simpler matching (see
 * below); they are short strings where ranking has little to order.
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

    // ts_headline re-parses the document it quotes from, so it is given the
    // body text only for rows that already matched and are already limited --
    // never as part of the scan itself. StartSel/StopSel are the shared
    // control-character sentinels rather than <mark>: ts_headline does not
    // escape the document, so emitting HTML here would hand article text
    // straight into the DOM (see SNIPPET_MARK_START's own comment).
    const ranked = await prisma.$queryRaw<{ id: string; rank: number; snippet: string | null }[]>`
      SELECT
        a."id",
        ts_rank(a."searchVector", websearch_to_tsquery('english', ${q})) AS rank,
        CASE
          WHEN a."extractedText" IS NULL THEN NULL
          ELSE ts_headline(
            'english',
            a."extractedText",
            websearch_to_tsquery('english', ${q}),
            ${`StartSel=${SNIPPET_MARK_START},StopSel=${SNIPPET_MARK_END},MaxWords=28,MinWords=10,ShortWord=3,MaxFragments=1`}
          )
        END AS snippet
      FROM "Article" a
      WHERE a."userId" = ${userId}
        AND a."deletedAt" IS NULL
        AND (
          a."searchVector" @@ websearch_to_tsquery('english', ${q})
          OR ${q} = ANY(a."tags")
        )
      ORDER BY rank DESC, a."savedAt" DESC, a."id" DESC
      LIMIT ${RESULT_LIMIT}
    `;

    const ids = ranked.map((r) => r.id);

    // Hydrated through Prisma rather than selected in the raw query above so
    // this keeps using toSummary -- one definition of the list DTO, including
    // its `omit` of the two large text columns. The raw query returns only
    // ids, ranks and snippets, which is also why it can afford to scan.
    const rows = ids.length
      ? await prisma.article.findMany({
          where: { id: { in: ids } },
          omit: { extractedHtml: true, extractedText: true },
        })
      : [];

    // findMany does not preserve the order of an `in` list, and that order is
    // the entire point here -- restore it from the ranking.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const articles = ids.map((id) => byId.get(id)).filter((row) => row !== undefined);

    const snippets: Record<string, string> = {};
    for (const r of ranked) {
      // ts_headline falls back to the document's opening words when the query
      // matched somewhere it cannot quote (a title-only or tag-only hit), which
      // reads as a snippet that does not contain the search terms. Only keep
      // one that actually shows a match.
      if (r.snippet && r.snippet.includes(SNIPPET_MARK_START)) snippets[r.id] = r.snippet;
    }

    // Highlights: still substring matching, but per-term rather than treating
    // the whole query as one literal. Without this, the multi-word fix above
    // would apply to articles while "flow state attention" kept matching no
    // highlights at all, which would read as a bug in the same search box.
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const highlightRows = await prisma.highlight.findMany({
      where: {
        userId,
        AND: terms.map((term) => ({
          OR: [
            { selectedText: { contains: term, mode: Prisma.QueryMode.insensitive } },
            { annotation: { noteText: { contains: term, mode: Prisma.QueryMode.insensitive } } },
          ],
        })),
      },
      include: { annotation: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RESULT_LIMIT,
    });

    const body: SearchResponse = {
      articles: articles.map(toSummary),
      highlights: highlightRows.map(toHighlight),
      snippets,
    };
    return reply.send(body);
  });
}
