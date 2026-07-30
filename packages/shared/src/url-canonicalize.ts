/**
 * The same article frequently has several cosmetically-different URLs in
 * the wild: a tracking-param-decorated share link, a trailing slash, an
 * uppercase host. Exact-string duplicate detection (Article's existing
 * `@@unique([userId, url])`) catches none of those. This normalizes a URL
 * to a stable, comparable form -- used to compute `Article.canonicalUrl`
 * at save time, not shown to the user (the raw `url` stays whatever they
 * actually saved, for display/provenance).
 */

// Known tracking-param prefixes/names -- an allowlist-of-what-to-strip
// approach (not a heuristic), same posture as an ad-blocker's param list.
// Deliberately conservative: stripping a param that actually changes the
// page's content would silently merge two different articles.
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^(fbclid|gclid|dclid|msclkid|twclid|igshid)$/i,
  /^mc_(cid|eid)$/i,
  /^(ref|ref_src|ref_url|referrer)$/i,
  /^(spm|icid|cmpid|ito)$/i,
  /^(yclid|_hsenc|_hsmi)$/i,
  /^si$/i, // YouTube/Spotify share-link identifier
];

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((p) => p.test(key));
}

/**
 * Returns null for an unparseable URL rather than throwing -- callers
 * already validate "is this a URL at all" separately (extraction would
 * have failed first), this just shouldn't be the thing that crashes a save.
 */
export function canonicalizeUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const params = [...parsed.searchParams.entries()].filter(([key]) => !isTrackingParam(key));
  params.sort(([a], [b]) => a.localeCompare(b));

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const protocol = parsed.protocol.toLowerCase();
  const isDefaultPort =
    !parsed.port || (protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443");
  const port = isDefaultPort ? "" : `:${parsed.port}`;

  // Trailing slash is only noise on a non-root path -- "example.com/" and
  // "example.com" are the same page, but "example.com/foo/" and
  // "example.com/foo" are conventionally the same too for this purpose
  // (article URLs don't rely on that distinction the way an API might).
  let path = parsed.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";

  const query = params.length > 0 ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";

  // Fragment intentionally dropped -- it never changes which extracted
  // article this is (this app fetches and parses the page server-side, it
  // doesn't render the live SPA), only, at most, scroll position.
  return `${protocol}//${host}${port}${path}${query}`;
}
