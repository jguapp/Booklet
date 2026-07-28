import dns from "node:dns/promises";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { ExtractedContent } from "@booklet/shared";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10MB safety cap
const MAX_REDIRECTS = 5;
const WORDS_PER_MINUTE = 200;
const USER_AGENT = "Mozilla/5.0 (compatible; BookletBot/1.0; +https://booklet.app)";

export class ExtractionError extends Error {}

/**
 * Fetches a user-supplied URL server-side and runs Readability against it.
 * Blocks requests (including each redirect hop) that resolve to a private/
 * loopback/link-local address -- without this, "save article by URL" is a
 * textbook SSRF vector (e.g. a saved "article" whose URL is
 * http://169.254.169.254/ or an internal service).
 */
export async function fetchAndExtract(rawUrl: string): Promise<ExtractedContent> {
  const html = await fetchHtml(rawUrl);

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url: rawUrl });
  } catch {
    throw new ExtractionError("Failed to parse the page.");
  }

  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.content) {
    throw new ExtractionError("Couldn't find readable article content on that page.");
  }

  const text = article.textContent?.trim() || null;
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const readingTimeEstimate = wordCount > 0 ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) : null;

  return {
    title: article.title?.trim() || dom.window.document.title.trim() || null,
    author: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || null,
    excerpt: article.excerpt?.trim() || null,
    html: article.content,
    text,
    readingTimeEstimate,
  };
}

async function fetchHtml(rawUrl: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new ExtractionError("Not a valid URL.");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new ExtractionError("Only http/https URLs are supported.");
    }
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new ExtractionError("Fetch timed out.");
      throw new ExtractionError("Failed to fetch the page.");
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new ExtractionError("Redirect with no destination.");
      current = new URL(location, current);
      continue;
    }

    if (!res.ok) throw new ExtractionError(`Fetch failed with status ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      throw new ExtractionError(`Unsupported content type: ${contentType || "unknown"}`);
    }

    const html = await res.text();
    if (html.length > MAX_HTML_BYTES) throw new ExtractionError("Page too large to extract.");
    return html;
  }

  throw new ExtractionError("Too many redirects.");
}

async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ExtractionError("Couldn't resolve that host.");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address, a.family))) {
    throw new ExtractionError("That URL points to a private or reserved network address.");
  }
}

function isPrivateOrReservedIp(address: string, family: number): boolean {
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice("::ffff:".length), 4);
  return false;
}
