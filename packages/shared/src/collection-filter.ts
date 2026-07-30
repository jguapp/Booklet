import type { CollectionFilter } from "./types/collection";

/**
 * In-memory equivalent of the API's filterToArticleWhere (collections.ts)
 * -- local/anonymous mode has no database to query, so a smart
 * collection's membership there is just this predicate run over the
 * already-loaded article list. Kept as one shared, tested implementation
 * of "what does this filter mean" rather than two that could drift.
 */
export interface FilterableArticle {
  status: string;
  favorited: boolean;
  tags: string[];
  title: string | null;
  excerpt: string | null;
  extractedText: string | null;
  deletedAt: string | null;
}

export function matchesCollectionFilter(article: FilterableArticle, filter: CollectionFilter): boolean {
  if (article.deletedAt !== null) return false;
  if (filter.status && article.status !== filter.status) return false;
  if (filter.favorited && !article.favorited) return false;
  if (filter.tags && filter.tags.length > 0 && !filter.tags.every((t) => article.tags.includes(t))) return false;
  if (filter.textQuery) {
    const q = filter.textQuery.toLowerCase();
    const haystack = `${article.title ?? ""} ${article.excerpt ?? ""} ${article.extractedText ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}
