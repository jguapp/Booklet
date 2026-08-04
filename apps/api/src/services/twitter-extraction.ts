/**
 * Builds a readable article out of an X/Twitter thread.
 *
 * The generic Readability path can't touch these: x.com serves a JS-rendered
 * shell with no article content, so a saved tweet lands as a FAILED
 * extraction with nothing to read. This uses the public syndication endpoint
 * behind embedded tweets (the same one `react-tweet` uses) -- no API key, no
 * auth -- and reconstructs the thread from it.
 *
 * That endpoint is undocumented and can change without notice, which is why
 * every function here returns null instead of throwing: the caller falls back
 * to generic extraction, leaving a tweet save no worse off than it is today.
 */

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const REQUEST_TIMEOUT_MS = 8_000;
// Each ancestor is a separate request on the save path. A real thread is
// rarely near this, and a chain longer than it isn't worth the latency.
const MAX_THREAD_TWEETS = 25;

interface SyndicationUser {
  name?: string;
  screen_name?: string;
}

interface SyndicationTweet {
  id_str?: string;
  text?: string;
  created_at?: string;
  user?: SyndicationUser;
  entities?: {
    urls?: { url?: string; expanded_url?: string; display_url?: string }[];
    media?: { url?: string }[];
  };
  photos?: { url?: string }[];
  parent?: { id_str?: string };
  in_reply_to_status_id_str?: string;
}

export interface ThreadTweet {
  id: string;
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt: string | null;
  photos: string[];
}

/**
 * Pull the tweet id out of any of the URL shapes X still serves:
 * x.com, twitter.com, the mobile/www subdomains, the legacy /statuses/ path,
 * and the /i/web/status/ form links sometimes use.
 */
export function parseTweetUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/^(?:(?:www|mobile|m)\.)?(?:twitter\.com|x\.com)$/i.test(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/(?:i\/web|[^/]+)\/status(?:es)?\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchTweet(id: string): Promise<SyndicationTweet | null> {
  try {
    // `token` is required but not validated -- the endpoint only checks that
    // one is present, which is why embedded tweets can pass an arbitrary one.
    const res = await fetch(`${SYNDICATION_URL}?id=${encodeURIComponent(id)}&lang=en&token=booklet`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BookletBot/1.0; +https://booklet.app)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SyndicationTweet;
    return body && typeof body === "object" && body.id_str ? body : null;
  } catch {
    return null;
  }
}

/** Expand t.co shorteners, and drop the trailing t.co that just points at the
 * tweet's own attached media (it renders as an image, not a link). */
function expandLinks(tweet: SyndicationTweet): string {
  let text = tweet.text ?? "";

  for (const url of tweet.entities?.urls ?? []) {
    if (url.url && url.expanded_url) text = text.split(url.url).join(url.expanded_url);
  }
  for (const media of tweet.entities?.media ?? []) {
    if (media.url) text = text.split(media.url).join("");
  }

  return text.trim();
}

function toThreadTweet(tweet: SyndicationTweet): ThreadTweet | null {
  const id = tweet.id_str;
  const handle = tweet.user?.screen_name;
  if (!id || !handle) return null;

  return {
    id,
    text: expandLinks(tweet),
    authorName: tweet.user?.name?.trim() || handle,
    authorHandle: handle,
    createdAt: tweet.created_at ?? null,
    photos: (tweet.photos ?? []).map((p) => p.url).filter((u): u is string => Boolean(u)),
  };
}

/**
 * Collect the thread containing `id`, walking *up* the reply chain.
 *
 * The syndication endpoint exposes a tweet's parent, never its children, so
 * this only reaches backwards: saving the last tweet of a thread captures all
 * of it, saving the first captures one tweet. Still strictly better than the
 * nothing-at-all this replaces, and it matches where people actually hit save
 * -- on the tweet they're reading, usually deep in the thread.
 *
 * Only self-replies are followed. A reply from someone else is a
 * conversation, not a thread, and pulling it in would attribute other
 * people's words to the author.
 */
export async function fetchTweetThread(id: string): Promise<ThreadTweet[] | null> {
  const root = await fetchTweet(id);
  if (!root) return null;

  const first = toThreadTweet(root);
  if (!first) return null;

  const thread = [first];
  const seen = new Set([first.id]);
  let parentId = root.parent?.id_str ?? root.in_reply_to_status_id_str ?? null;

  while (parentId && thread.length < MAX_THREAD_TWEETS && !seen.has(parentId)) {
    seen.add(parentId);
    const parentRaw = await fetchTweet(parentId);
    if (!parentRaw) break;

    const parent = toThreadTweet(parentRaw);
    if (!parent || parent.authorHandle.toLowerCase() !== first.authorHandle.toLowerCase()) break;

    thread.unshift(parent);
    parentId = parentRaw.parent?.id_str ?? parentRaw.in_reply_to_status_id_str ?? null;
  }

  return thread;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render the thread as plain article HTML. Images stay as remote URLs here;
 * the caller inlines them with the same helper every other saved article
 * uses, so a saved thread is self-contained the same way. */
export function renderThreadHtml(thread: ThreadTweet[]): string {
  const blocks = thread.map((tweet) => {
    const paragraphs = tweet.text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
      .join("\n");

    const images = tweet.photos.map((url) => `<img src="${escapeHtml(url)}" alt="" />`).join("\n");
    return `<section>\n${paragraphs}\n${images}\n</section>`;
  });

  return `<article>\n${blocks.join("\n")}\n</article>`;
}

export function threadToText(thread: ThreadTweet[]): string {
  return thread.map((tweet) => tweet.text).join("\n\n").trim();
}

/** First line of the thread, trimmed to something that reads as a title. */
export function threadTitle(thread: ThreadTweet[]): string {
  const opener = thread[0]?.text.split("\n").find((line) => line.trim()) ?? "";
  const trimmed = opener.trim();
  if (!trimmed) return `Thread by @${thread[0]?.authorHandle ?? "unknown"}`;
  return trimmed.length > 100 ? `${trimmed.slice(0, 99).trimEnd()}…` : trimmed;
}
