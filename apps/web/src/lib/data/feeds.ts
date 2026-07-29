/**
 * The local-vs-synced swap point for RSS feed subscriptions. Fetching/
 * parsing a feed's current items never touches user data (same as article
 * extraction), so it always goes through the public preview endpoint --
 * only the subscription list itself differs between local (IndexedDB) and
 * authenticated (server) mode.
 */
import type { CreateFeedRequest, Feed, FetchedFeed } from "@booklet/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { localFeeds } from "@/lib/local/db";

export { ApiError };

async function previewFeed(url: string): Promise<FetchedFeed> {
  return apiFetch<FetchedFeed>("/api/feeds/preview", { method: "POST", body: JSON.stringify({ url }), auth: false });
}

export async function loadFeeds(authenticated: boolean): Promise<Feed[]> {
  if (authenticated) return apiFetch<Feed[]>("/api/feeds");
  const feeds = await localFeeds.getAll();
  return feeds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function subscribeFeed(url: string, authenticated: boolean): Promise<Feed> {
  if (authenticated) {
    return apiFetch<Feed>("/api/feeds", { method: "POST", body: JSON.stringify({ url } satisfies CreateFeedRequest) });
  }

  const existing = (await localFeeds.getAll()).find((f) => f.url === url);
  if (existing) {
    throw new ApiError(409, "already_subscribed", "You're already subscribed to this feed.");
  }

  const fetched = await previewFeed(url);
  const feed: Feed = {
    id: crypto.randomUUID(),
    userId: "local",
    url,
    title: fetched.title,
    createdAt: new Date().toISOString(),
  };
  await localFeeds.put(feed);
  return feed;
}

export async function unsubscribeFeed(id: string, authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/feeds/${id}`, { method: "DELETE" });
    return;
  }
  await localFeeds.delete(id);
}

export async function loadFeedItems(feed: Feed, authenticated: boolean): Promise<FetchedFeed> {
  if (authenticated) return apiFetch<FetchedFeed>(`/api/feeds/${feed.id}/items`);
  return previewFeed(feed.url);
}
