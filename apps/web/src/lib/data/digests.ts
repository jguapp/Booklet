import type { Digest } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

/**
 * Authenticated only -- local/anonymous mode doesn't persist a Digest row,
 * it just re-runs selectHighlightsToResurface client-side on each visit
 * (see the resurface page). That's fine single-device; a stable, synced
 * batch across devices/reloads is exactly what signing in buys you here.
 */
export async function loadCurrentDigest(): Promise<Digest> {
  return apiFetch<Digest>("/api/digests/current");
}
