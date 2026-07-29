/**
 * The local-vs-synced swap point for search, same shape as the other
 * lib/data/*.ts modules. Authenticated mode has to ask the server: the
 * article list the Library page already has in memory is ArticleSummary
 * (no extractedText -- see @booklet/shared), so there's no way to search
 * body text client-side without it. Local mode's Article objects always
 * have the full text already (no summary/full split for IndexedDB), so
 * that half runs entirely in the browser, matching the server's own
 * plain-substring (not tsvector) matching -- see apps/api's search route
 * for why that's the deliberate choice, not a cut corner.
 */
import type { SearchResponse } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { localArticles, localHighlights } from "@/lib/local/db";

function matches(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle);
}

export async function searchLibrary(query: string, authenticated: boolean): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { articles: [], highlights: [] };

  if (authenticated) {
    return apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);
  }

  const needle = q.toLowerCase();
  const [allArticles, allHighlights] = await Promise.all([localArticles.getAll(), localHighlights.getAll()]);

  const articles = allArticles
    .filter(
      (a) =>
        matches(a.title, needle) ||
        matches(a.excerpt, needle) ||
        matches(a.author, needle) ||
        matches(a.siteName, needle) ||
        matches(a.extractedText, needle) ||
        a.tags.some((t) => t.toLowerCase().includes(needle)),
    )
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  const highlights = allHighlights
    .filter((h) => matches(h.selectedText, needle) || matches(h.annotation?.noteText, needle))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { articles, highlights };
}
