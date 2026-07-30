import dns from "node:dns/promises";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { ExtractedContent } from "@booklet/shared";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10MB safety cap
const MAX_REDIRECTS = 5;
const WORDS_PER_MINUTE = 200;
const USER_AGENT = "Mozilla/5.0 (compatible; BookletBot/1.0; +https://booklet.app)";

// Images referenced by src="https://original-site.com/..." break the moment
// that site takes the image down, blocks hotlinking, or gates it behind a
// login -- and even before any of that, every open of the saved article
// pings the original site. Inline them as data: URIs instead so a saved
// article is actually self-contained, the same way an uploaded PDF/EPUB
// already is. Bounded on every axis since these URLs are attacker-influenced
// (a malicious page could reference arbitrarily many/large images).
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB per image
const MAX_TOTAL_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB across the whole article
const MAX_IMAGES = 30;
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const IMAGE_FETCH_CONCURRENCY = 4;

export class ExtractionError extends Error {}

/**
 * Fetches a user-supplied URL server-side and runs Readability against it.
 * Blocks requests (including each redirect hop) that resolve to a private/
 * loopback/link-local address -- without this, "save article by URL" is a
 * textbook SSRF vector (e.g. a saved "article" whose URL is
 * http://169.254.169.254/ or an internal service).
 */
export async function fetchAndExtract(rawUrl: string): Promise<ExtractedContent> {
  const pageHtml = await fetchHtml(rawUrl);

  let dom: JSDOM;
  try {
    dom = new JSDOM(pageHtml, { url: rawUrl });
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

  // Best-effort: an article with un-inlined (still remote) images is still
  // a perfectly good save, so a total failure here shouldn't fail the save.
  // (article.content narrowed into a plain variable -- narrowing on a
  // property access like article.content doesn't survive into the .catch
  // closure below, since TS can't prove it stays truthy by then.)
  const content = article.content;
  const { html, skippedImageCount } = await inlineImages(content, rawUrl).catch(() => ({
    html: content,
    skippedImageCount: 0,
  }));

  return {
    title: article.title?.trim() || dom.window.document.title.trim() || null,
    author: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || null,
    excerpt: article.excerpt?.trim() || null,
    html,
    text,
    readingTimeEstimate,
    skippedImageCount,
  };
}

// Exported for unit testing -- fetchAndExtract itself needs a real network
// fetch of the page HTML to test end to end.
export async function inlineImages(
  html: string,
  baseUrl: string,
): Promise<{ html: string; skippedImageCount: number }> {
  const fragment = new JSDOM(html);
  const doc = fragment.window.document;
  const imgs = Array.from(doc.querySelectorAll("img[src]"));
  if (imgs.length === 0) return { html, skippedImageCount: 0 };

  const uniqueSrcs = [...new Set(imgs.map((img) => img.getAttribute("src")!).filter(Boolean))];
  // Beyond MAX_IMAGES, the rest are skipped outright -- never even attempted.
  const attemptedSrcs = uniqueSrcs.slice(0, MAX_IMAGES);
  const dataUriBySrc = new Map<string, string>();
  let totalBytes = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < attemptedSrcs.length && totalBytes < MAX_TOTAL_IMAGE_BYTES) {
      const src = attemptedSrcs[nextIndex++];
      const dataUri = await fetchImageAsDataUri(src, baseUrl, MAX_TOTAL_IMAGE_BYTES - totalBytes);
      if (dataUri) {
        dataUriBySrc.set(src, dataUri.uri);
        totalBytes += dataUri.byteLength;
      }
    }
  }
  await Promise.all(Array.from({ length: IMAGE_FETCH_CONCURRENCY }, worker));

  // Every unique image src that didn't end up inlined -- past MAX_IMAGES,
  // over MAX_IMAGE_BYTES/MAX_TOTAL_IMAGE_BYTES, or just failed to fetch
  // (dead link, blocked, non-image response). All read the same to the
  // user: still pointing at the original site, so still able to break.
  const skippedImageCount = uniqueSrcs.length - dataUriBySrc.size;

  if (dataUriBySrc.size === 0) return { html, skippedImageCount };
  for (const img of imgs) {
    const src = img.getAttribute("src");
    const dataUri = src && dataUriBySrc.get(src);
    if (dataUri) img.setAttribute("src", dataUri);
  }
  return { html: doc.body.innerHTML, skippedImageCount };
}

async function fetchImageAsDataUri(
  src: string,
  baseUrl: string,
  remainingBudget: number,
): Promise<{ uri: string; byteLength: number } | null> {
  let url: URL;
  try {
    url = new URL(src, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  try {
    await assertPublicHost(url.hostname);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
  if (!contentType || !contentType.startsWith("image/")) return null;

  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > Math.min(MAX_IMAGE_BYTES, remainingBudget)) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (buffer.length > MAX_IMAGE_BYTES || buffer.length > remainingBudget) return null;

  return { uri: `data:${contentType};base64,${buffer.toString("base64")}`, byteLength: buffer.length };
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
