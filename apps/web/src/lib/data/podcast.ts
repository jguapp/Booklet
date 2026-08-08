import type { PodcastFeedSecret, PodcastFeedStatus } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

/**
 * Personal podcast feed (#154). Authenticated-account-only, same as
 * developer.ts and for the same reason: the feed is a URL some *other*
 * system fetches on its own schedule, which needs a synced account behind it
 * -- there is no local/anonymous-mode equivalent.
 *
 * Note what is missing: there is no "read the feed URL" call. The server only
 * stores the token's hash, so regenerating is the only way back to a URL
 * someone lost -- see routes/podcast.ts for why keeping a readable copy would
 * be the wrong trade.
 */

export function loadPodcastFeedStatus(): Promise<PodcastFeedStatus> {
  return apiFetch<PodcastFeedStatus>("/api/podcast/feed");
}

/** Mints a URL, revoking any previous one. */
export function createPodcastFeed(): Promise<PodcastFeedSecret> {
  return apiFetch<PodcastFeedSecret>("/api/podcast/feed", { method: "POST" });
}

export function revokePodcastFeed(): Promise<void> {
  return apiFetch("/api/podcast/feed", { method: "DELETE" });
}
