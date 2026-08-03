import type { ArticleStatus } from "./article";

/**
 * A saved-search filter -- when present on a Collection, membership is
 * computed on the fly (matching articles, live) instead of stored via
 * ArticleCollection join rows. AND semantics only for v1: composable
 * enough for the common cases ("Unread AND tagged 'later'") without
 * needing a query-language parser.
 */
export interface CollectionFilter {
  status?: ArticleStatus;
  tags?: string[];
  favorited?: boolean;
  textQuery?: string;
}

export interface Collection {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  /** Null for an ordinary, manually-curated collection. Present (even if
   * every field inside is empty/undefined) marks this as a smart
   * collection -- see CollectionFilter. */
  filter: CollectionFilter | null;
  /** Self-referential -- null for a top-level collection. Smart
   * collections can't have children or be nested under one (a computed
   * membership doesn't compose meaningfully with a tree position). */
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list endpoints -- omitted where it'd cost an extra query for no reason. */
  articleCount?: number;
}

/** Bulk membership for a whole article list -- articleId -> the collectionIds
 * it belongs to. Kept separate from Article/ArticleSummary itself (rather
 * than embedding a `collectionIds` field there) since it needs its own
 * always-fresh fetch: membership changes don't bump the article's own
 * updatedAt, and smart collections' membership isn't stored on the article
 * at all. */
export type ArticleCollectionMemberships = Record<string, string[]>;

export interface CreateCollectionRequest {
  name: string;
  color?: string | null;
  filter?: CollectionFilter | null;
  parentId?: string | null;
}

export interface UpdateCollectionRequest {
  name?: string;
  color?: string | null;
  parentId?: string | null;
}
