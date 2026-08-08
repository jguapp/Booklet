/**
 * The local-vs-synced swap point for search, same shape as the other
 * lib/data/*.ts modules.
 *
 * Both sides now do real ranked full-text search (#155) rather than the plain
 * `contains` they shared before. Authenticated mode asks the server, which
 * ranks with Postgres tsvector/ts_rank (see apps/api's search route); local
 * mode builds its own index over the IndexedDB articles (see
 * local-search-index.ts). That split is the point rather than a compromise:
 * full-text search used to be rejected outright *because* local mode had no
 * equivalent, and this app's principle is that both modes behave the same.
 *
 * Comparable, not identical. The two scorers order near-ties differently, and
 * Porter (client) and Snowball (Postgres) disagree on a handful of words. What
 * matches is everything a reader would notice: stemming, multi-word AND,
 * title hits outranking body mentions, and snippets.
 *
 * Local mode still does the whole thing in the browser for the same reason as
 * before -- its Article objects always carry full extractedText (there is no
 * summary/full split for IndexedDB), so it has everything the index needs.
 */
import type { SearchResponse } from "@booklet/shared";
import { reciprocalRankFusion } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { localArticles, localHighlights } from "@/lib/local/db";
import { hasLocalEmbeddings, loadSemanticSearchEnabled, semanticSearchLocal } from "@/lib/search/local-embeddings";
import { buildSnippet, getArticleIndex, highlightMatches } from "./local-search-index";

const RESULT_LIMIT = 25;

/**
 * The semantic half (#156), fused into the keyword ranking exactly as the
 * server route does it -- same RRF, so the two modes order results the same
 * way rather than merely both "having semantic search".
 *
 * Gated twice on purpose. The setting being off is a user's explicit choice
 * not to spend a 25MB download; nothing indexed yet means there is nothing to
 * match, and spinning up the worker would trigger that download to produce an
 * empty list. Either way this returns nothing and the caller keeps the plain
 * keyword ranking.
 *
 * Failure is non-fatal, same as the server: a model still downloading or
 * weights that will not load degrade search rather than break it.
 */
async function semanticIdsForLocal(q: string): Promise<string[]> {
  if (!loadSemanticSearchEnabled()) return [];
  try {
    if (!(await hasLocalEmbeddings())) return [];
    return await semanticSearchLocal(q, RESULT_LIMIT);
  } catch {
    return [];
  }
}

export async function searchLibrary(query: string, authenticated: boolean): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { articles: [], highlights: [] };

  if (authenticated) {
    return apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);
  }

  const [allArticles, allHighlights] = await Promise.all([localArticles.getAll(), localHighlights.getAll()]);

  // Trashed articles are excluded here rather than in the index, so trashing
  // something doesn't invalidate the whole index and force a rebuild.
  const searchable = allArticles.filter((a) => !a.deletedAt);
  const index = getArticleIndex(searchable);
  const byId = new Map(searchable.map((a) => [a.id, a]));

  const keywordIds = index.search(q).map((r) => r.id as string);
  const semanticIds = (await semanticIdsForLocal(q))
    // Trashed articles keep their embeddings (so restoring doesn't re-index),
    // so they have to be filtered out here the way the keyword index avoids
    // them by construction.
    .filter((id) => byId.has(id));

  // With no semantic side this preserves the keyword order exactly, so the
  // disabled path is a genuine no-op rather than a separate branch.
  const ids = reciprocalRankFusion(semanticIds.length ? [keywordIds, semanticIds] : [keywordIds])
    .map((r) => r.id)
    .slice(0, RESULT_LIMIT);
  const articles = ids.map((id) => byId.get(id)).filter((a) => a !== undefined);

  const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const snippets: Record<string, string> = {};
  for (const article of articles) {
    const snippet = buildSnippet(article.extractedText ?? "", terms);
    if (snippet) snippets[article.id] = snippet;
  }

  const highlights = allHighlights
    .filter((h) => highlightMatches(h, terms))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RESULT_LIMIT);

  return { articles, highlights, snippets };
}
