/**
 * RSS/Atom feed subscriptions. Feed itself is just the subscription --
 * items are fetched live (see FeedItem/FetchedFeed below), never persisted,
 * since there's no background worker in this app to poll them on a
 * schedule. See apps/api/src/services/rss-service.ts.
 */
export interface Feed {
  id: string;
  userId: string;
  url: string;
  title: string | null;
  createdAt: string;
}

export interface CreateFeedRequest {
  url: string;
}

export interface FeedItem {
  title: string | null;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
}

/** GET /api/feeds/:id/items and the public preview endpoint -- a live fetch
 * of the feed's current items, not a stored/paginated resource. */
export interface FetchedFeed {
  title: string | null;
  items: FeedItem[];
}
