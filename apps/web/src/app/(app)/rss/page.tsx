"use client";

import { useCallback, useEffect, useState } from "react";
import type { Feed, FeedItem } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTrash } from "@/components/ui/icons";
import { loadFeeds, loadFeedItems, subscribeFeed, unsubscribeFeed, ApiError } from "@/lib/data/feeds";
import { saveArticleFromUrl } from "@/lib/data/articles";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { formatRelativeDate } from "@/lib/format";

interface ItemsState {
  items: FeedItem[] | null; // null while loading
  error: string | null;
}

export default function RssPage() {
  const { status, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [itemsByFeed, setItemsByFeed] = useState<Record<string, ItemsState>>({});
  const [savingLinks, setSavingLinks] = useState<Set<string>>(new Set());

  const refreshFeeds = useCallback(() => {
    if (status === "loading") return;
    loadFeeds(isAuthenticated).then((loadedFeeds) => {
      setFeeds(loadedFeeds);
      setLoaded(true);
    });
  }, [status, isAuthenticated]);

  useEffect(() => {
    refreshFeeds();
  }, [refreshFeeds]);

  const loadItemsFor = useCallback(
    (feed: Feed) => {
      setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: null, error: null } }));
      loadFeedItems(feed, isAuthenticated)
        .then((fetched) => {
          setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: fetched.items, error: null } }));
        })
        .catch((err) => {
          const message = err instanceof ApiError ? err.message : "Couldn't fetch this feed.";
          setItemsByFeed((prev) => ({ ...prev, [feed.id]: { items: null, error: message } }));
        });
    },
    [isAuthenticated],
  );

  useEffect(() => {
    feeds.forEach(loadItemsFor);
    // Intentionally keyed on the feed list itself, not loadItemsFor's identity --
    // this should only re-fetch when the *set of feeds* changes (subscribe/unsubscribe),
    // not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeds]);

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubscribing(true);
    setSubscribeError(null);
    try {
      const feed = await subscribeFeed(url.trim(), isAuthenticated);
      setFeeds((prev) => [feed, ...prev]);
      setUrl("");
    } catch (err) {
      setSubscribeError(err instanceof ApiError ? err.message : "Couldn't subscribe to that feed.");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleUnsubscribe(feed: Feed) {
    await unsubscribeFeed(feed.id, isAuthenticated);
    setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
    setItemsByFeed((prev) => {
      const next = { ...prev };
      delete next[feed.id];
      return next;
    });
  }

  async function handleSaveItem(item: FeedItem) {
    if (!item.link) return;
    setSavingLinks((prev) => new Set(prev).add(item.link!));
    try {
      await saveArticleFromUrl(item.link, isAuthenticated);
      toast(`Saved "${item.title ?? item.link}".`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast("Already saved.");
      else toast("Couldn't save that article.");
    } finally {
      setSavingLinks((prev) => {
        const next = new Set(prev);
        next.delete(item.link!);
        return next;
      });
    }
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold text-ink">RSS</h1>
      </div>

      <form onSubmit={handleSubscribe} className="mb-8 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="https://example.com/feed.xml"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={subscribing}
            className="flex-1"
          />
          <Button type="submit" variant="primary" disabled={subscribing}>
            {subscribing ? "Subscribing…" : "Subscribe"}
          </Button>
        </div>
        {subscribeError && <p className="font-sans text-xs text-red-500">{subscribeError}</p>}
      </form>

      {feeds.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            No feeds yet -- subscribe to an RSS or Atom feed URL above.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {feeds.map((feed) => {
            const state = itemsByFeed[feed.id];
            return (
              <div key={feed.id}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-serif text-lg font-semibold text-ink">
                      {feed.title ?? feed.url}
                    </h2>
                    <p className="truncate font-sans text-xs text-ink-faint">{feed.url}</p>
                  </div>
                  <button
                    type="button"
                    title="Unsubscribe"
                    onClick={() => handleUnsubscribe(feed)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>

                {!state || state.items === null ? (
                  state?.error ? (
                    <p className="font-sans text-sm text-ink-faint">{state.error}</p>
                  ) : (
                    <p className="font-sans text-sm text-ink-faint">Loading…</p>
                  )
                ) : state.items.length === 0 ? (
                  <p className="font-sans text-sm text-ink-faint">No items in this feed.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {state.items.map((item, i) => (
                      <div key={item.link ?? i} className="rounded-md border border-border bg-surface px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <a
                              href={item.link ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="font-serif text-base font-semibold leading-snug text-ink hover:text-accent"
                            >
                              {item.title ?? "Untitled"}
                            </a>
                            {item.publishedAt && (
                              <p className="mt-1 font-sans text-xs text-ink-faint">
                                {formatRelativeDate(item.publishedAt)}
                              </p>
                            )}
                            {item.summary && (
                              <p className="mt-2 line-clamp-2 font-sans text-sm text-ink-muted">{item.summary}</p>
                            )}
                          </div>
                          {item.link && (
                            <Button
                              variant="secondary"
                              onClick={() => handleSaveItem(item)}
                              disabled={savingLinks.has(item.link)}
                              className="shrink-0 px-3 py-1.5 text-xs"
                            >
                              {savingLinks.has(item.link) ? "Saving…" : "Save"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
