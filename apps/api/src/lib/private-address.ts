/**
 * SSRF protection for the two places this app fetches a user-supplied URL
 * server-side: article extraction and RSS feed fetching.
 *
 * Without it, "save this URL" and "subscribe to this feed" are both textbook
 * SSRF vectors -- a saved "article" pointing at http://169.254.169.254/ or an
 * internal service is the whole attack. Both call sites check every redirect
 * hop, not just the initial URL, since a public host can redirect inward.
 *
 * This lived twice, copied verbatim into extraction-service.ts and
 * rss-service.ts. Two copies of a security control is how one of them
 * quietly stops matching the other -- and it already had: only the
 * extraction copy understood the test escape hatch below, so the e2e suite
 * could serve article fixtures locally but not feed fixtures.
 */
import dns from "node:dns/promises";

/**
 * Test-only escape hatch, so the e2e suite can serve fixtures from a
 * loopback HTTP server instead of fetching real pages off the internet for
 * every spec that just needs content to exist (see
 * apps/web/e2e/fixture-server).
 *
 * Two properties make this safe to have at all:
 *
 *  - Evaluated once, at module load, and `NODE_ENV === "production"`
 *    hard-disables it. Setting the variable on a production deployment does
 *    nothing whatsoever -- this protection is not overridable where it
 *    actually matters, only in an environment that has already opted out of
 *    being one.
 *  - It requires the exact string "true", and its name says what it does
 *    rather than something innocuous like ALLOW_LOCAL.
 *
 * Anyone tempted to reach for this outside tests should not.
 */
const ALLOW_PRIVATE_ADDRESSES =
  process.env.NODE_ENV !== "production" && process.env.EXTRACTION_ALLOW_PRIVATE_ADDRESSES === "true";

if (ALLOW_PRIVATE_ADDRESSES) {
  console.warn(
    "[security] EXTRACTION_ALLOW_PRIVATE_ADDRESSES is set: URL fetches to private/loopback addresses are permitted. " +
      "This is for the e2e fixture server only and is ignored entirely when NODE_ENV=production.",
  );
}

export type HostCheck = { ok: true } | { ok: false; reason: "unresolvable" | "private" };

/**
 * Resolves `hostname` and reports whether it is safe to fetch.
 *
 * Returns a result rather than throwing so each caller can raise its own
 * error type (`ExtractionError` vs `FeedFetchError`) with its own wording --
 * which is what the two copies were really doing differently.
 */
export async function checkPublicHost(hostname: string): Promise<HostCheck> {
  if (ALLOW_PRIVATE_ADDRESSES) return { ok: true };

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address, a.family))) {
    return { ok: false, reason: "private" };
  }
  return { ok: true };
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
