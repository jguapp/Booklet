/**
 * Authenticated only -- mirrors the web app's lib/data/digests.ts. Local/
 * anonymous mode doesn't persist a Digest row; it re-runs
 * selectHighlightsToResurface client-side on each visit instead (see
 * DailyReviewScreen) -- fine single-device, which is all local mode ever is.
 *
 * The web module's other export, emailDigest (POST /api/digests/:id/email),
 * has no counterpart here on purpose: there is no "email me this" control on
 * DailyReviewScreen, and the digest email is already sent on the user's
 * configured schedule by the server regardless of which client they read on.
 */
import type { Digest } from "@booklet/shared";
import { apiFetch } from "../api";

export async function loadCurrentDigest(): Promise<Digest> {
  return apiFetch<Digest>("/api/digests/current");
}
