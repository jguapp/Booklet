/**
 * A stable, opaque id for this browser (#152).
 *
 * Exists for exactly one question: when an article carries a synced listening
 * position, was it this browser that left it there, or another one? Without an
 * answer, the resume prompt offers to resume from a position the current tab
 * wrote seconds ago, which is noise rather than a feature.
 *
 * This identifies a *browser*, not a person. It is generated locally, never
 * sent anywhere except as the `listeningDeviceId` on the article the user is
 * already syncing, and never shown in the UI. Clearing site data resets it,
 * which costs nothing worse than one redundant resume prompt.
 *
 * localStorage rather than IndexedDB because it is read synchronously on the
 * render path that decides whether to show the prompt, and it is a single
 * short string.
 */

const DEVICE_ID_KEY = "booklet:device-id";

/** Cached so repeated renders don't re-hit storage, and so a mid-session
 * storage failure can't hand out two different ids for one browser. */
let cached: string | null = null;

function generate(): string {
  // randomUUID is unavailable in non-secure contexts (plain http:// on a LAN
  // address, which is a real way people open this on a phone), so it cannot be
  // the only path. The fallback doesn't need to be cryptographically strong --
  // a collision between two of the user's own devices costs one wrong resume
  // prompt, not a correctness or privacy failure.
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const fresh = generate();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Private browsing or blocked storage: still return a usable id for this
    // session rather than throwing into the playback path. It won't survive a
    // reload, so this browser will look like a new device each time -- the
    // resume prompt degrades to being offered slightly more often, which is
    // the harmless direction to fail in.
    cached ??= generate();
    return cached;
  }
}
