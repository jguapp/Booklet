/**
 * Authenticated only -- mirrors the web app's lib/data/digests.ts. Local/
 * anonymous mode doesn't persist a Digest row; it re-runs
 * selectHighlightsToResurface client-side on each visit instead (see
 * DailyReviewScreen) -- fine single-device, which is all local mode ever is.
 */
import type { Digest } from "@booklet/shared";
import { apiFetch } from "../api";

export async function loadCurrentDigest(): Promise<Digest> {
  return apiFetch<Digest>("/api/digests/current");
}
