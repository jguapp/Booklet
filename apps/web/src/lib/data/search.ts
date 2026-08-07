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
import { apiFetch } from "@/lib/api/client";
import { localArticles, localHighlights } from "@/lib/local/db";
import { buildSnippet, getArticleIndex, highlightMatches } from "./local-search-index";

const RESULT_LIMIT = 25;

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

  const ranked = index.search(q).slice(0, RESULT_LIMIT);
  const articles = ranked.map((r) => byId.get(r.id as string)).filter((a) => a !== undefined);

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
