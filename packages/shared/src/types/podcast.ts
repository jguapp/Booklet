/**
 * Personal podcast feed (#154) -- the reading queue exposed as an RSS feed
 * that any podcast app can subscribe to.
 *
 * Shared rather than API-local because the settings UI has to describe the
 * feed's contents accurately ("your unread queue", not "your library") and
 * that description is only true if both sides agree on the same filter set.
 */

/**
 * Which slice of the library the feed lists. The issue left this open
 * ("whole library, unread only, or a dedicated listen queue?"); the answer
 * here is that the *default* is the queue, for a reason specific to how
 * podcast clients behave rather than to taste.
 *
 * A podcast client treats every item it has not seen before as a new,
 * unplayed episode and -- with auto-download on, which is the default in
 * most clients -- downloads it. Defaulting to the whole library therefore
 * means someone with a 400-article backlog gets 400 unplayed episodes and
 * tens of gigabytes of downloads the moment they subscribe, which is not a
 * feature, it is an incident. "Queue" (unread + in-progress, never archived
 * or trashed) matches both what a listener actually wants next and what the
 * client is going to do with it.
 *
 * "all" stays available for the person who deliberately wants their archive
 * as a back catalogue, but they have to ask for it.
 */
export type PodcastFeedFilter = "queue" | "all";

export const PODCAST_FEED_FILTERS: readonly PodcastFeedFilter[] = ["queue", "all"];

export const DEFAULT_PODCAST_FEED_FILTER: PodcastFeedFilter = "queue";

export function isPodcastFeedFilter(value: unknown): value is PodcastFeedFilter {
  return typeof value === "string" && (PODCAST_FEED_FILTERS as readonly string[]).includes(value);
}

/**
 * The scope carried by the ApiToken row behind a feed URL.
 *
 * Deliberately not one of api-tokens.ts's VALID_SCOPES, so the "create a
 * personal access token" form can never mint one: a feed token is handed out
 * embedded in a URL, which means it lands in podcast-client databases, sync
 * services and server access logs in a way a header-only PAT never does. A
 * credential with that exposure profile must not also be able to POST
 * articles to /api/v1.
 */
export const PODCAST_FEED_SCOPE = "feed";

/** What the settings UI knows about a feed without being able to see the URL. */
export interface PodcastFeedStatus {
  enabled: boolean;
  createdAt: string | null;
  /** When a podcast client last fetched the feed -- the only "is this
   * actually working?" signal available, since clients report nothing. */
  lastFetchedAt: string | null;
}

/**
 * Returned exactly once, when the URL is minted or regenerated. The raw
 * token is never stored (only its hash is), so there is no endpoint that can
 * show this again -- same contract as a personal access token, and for a
 * stronger reason: this URL is a bearer credential for the full text and
 * audio of everything the account has saved.
 */
export interface PodcastFeedSecret extends PodcastFeedStatus {
  url: string;
}
