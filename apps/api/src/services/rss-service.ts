import { JSDOM } from "jsdom";
import { checkPublicHost } from "../lib/private-address.js";
import type { FetchedFeed, FeedItem } from "@booklet/shared";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024; // 5MB safety cap
const MAX_REDIRECTS = 5;
const MAX_ITEMS = 50;
const USER_AGENT = "Mozilla/5.0 (compatible; BookletBot/1.0; +https://booklet.app)";

export class FeedFetchError extends Error {}

/**
 * Fetches a user-supplied feed URL server-side and parses it -- RSS 2.0 and
 * Atom, live on every call rather than persisted/polled (no background
 * worker in this app). Same SSRF hardening as article extraction
 * (extraction-service.ts): this is another endpoint that fetches an
 * arbitrary attacker-influenced URL, including on every redirect hop.
 * Duplicated rather than shared -- small, security-critical, and safer to
 * keep each call site self-contained than to risk a shared abstraction
 * subtly changing either one.
 */
export async function fetchFeed(rawUrl: string): Promise<FetchedFeed> {
  const xml = await fetchXml(rawUrl);
  return parseFeed(xml);
}

export function parseFeed(xml: string): FetchedFeed {
  let dom: JSDOM;
  try {
    dom = new JSDOM(xml, { contentType: "text/xml" });
  } catch {
    throw new FeedFetchError("That doesn't look like a valid RSS or Atom feed.");
  }
  const doc = dom.window.document;
  const root = doc.documentElement?.localName?.toLowerCase();

  if (root === "feed") {
    // Atom
    const title = doc.querySelector(":scope > title")?.textContent?.trim() || null;
    const items: FeedItem[] = Array.from(doc.querySelectorAll("entry"))
      .slice(0, MAX_ITEMS)
      .map((entry) => {
        const link =
          entry.querySelector("link[rel='alternate']")?.getAttribute("href") ??
          entry.querySelector("link")?.getAttribute("href") ??
          null;
        return {
          title: entry.querySelector("title")?.textContent?.trim() || null,
          link,
          publishedAt: entry.querySelector("published")?.textContent?.trim() || entry.querySelector("updated")?.textContent?.trim() || null,
          summary: entry.querySelector("summary")?.textContent?.trim() || entry.querySelector("content")?.textContent?.trim() || null,
        };
      });
    if (!title && items.length === 0) throw new FeedFetchError("That doesn't look like a valid RSS or Atom feed.");
    return { title, items };
  }

  if (root === "rss" || root === "rdf") {
    const title = doc.querySelector("channel > title")?.textContent?.trim() || null;
    const items: FeedItem[] = Array.from(doc.querySelectorAll("item"))
      .slice(0, MAX_ITEMS)
      .map((item) => ({
        title: item.querySelector("title")?.textContent?.trim() || null,
        link: item.querySelector("link")?.textContent?.trim() || null,
        publishedAt: item.querySelector("pubDate")?.textContent?.trim() || item.querySelector("date")?.textContent?.trim() || null,
        summary: item.querySelector("description")?.textContent?.trim() || null,
      }));
    if (!title && items.length === 0) throw new FeedFetchError("That doesn't look like a valid RSS or Atom feed.");
    return { title, items };
  }

  throw new FeedFetchError("That doesn't look like a valid RSS or Atom feed.");
}

async function fetchXml(rawUrl: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new FeedFetchError("Not a valid URL.");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new FeedFetchError("Only http/https URLs are supported.");
    }
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new FeedFetchError("Fetch timed out.");
      throw new FeedFetchError("Failed to fetch that feed.");
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new FeedFetchError("Redirect with no destination.");
      current = new URL(location, current);
      continue;
    }

    if (!res.ok) throw new FeedFetchError(`Fetch failed with status ${res.status}`);

    // Deliberately not checking content-type against an allowlist -- plenty
    // of real feeds are served as text/html or with no content-type at all.
    // parseFeed() is the actual validation (root element must look like a
    // feed), which is a stronger signal than a header the server controls.
    const xml = await res.text();
    if (xml.length > MAX_FEED_BYTES) throw new FeedFetchError("Feed too large.");
    return xml;
  }

  throw new FeedFetchError("Too many redirects.");
}

async function assertPublicHost(hostname: string): Promise<void> {
  const check = await checkPublicHost(hostname);
  if (check.ok) return;
  throw new FeedFetchError(
    check.reason === "unresolvable"
      ? "Couldn't resolve that host."
      : "That URL points to a private or reserved network address.",
  );
}
