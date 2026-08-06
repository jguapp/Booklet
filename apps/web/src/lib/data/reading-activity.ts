/**
 * Real per-day reading activity, for the stats page's heatmap -- see
 * apps/api's ReadingActivityDay for why this needs its own endpoint rather
 * than being derived from Article's own timestamps.
 *
 * Signed-in only: local/anonymous mode's updateArticleProgress only ever
 * accumulates a lifetime total per article in IndexedDB (no per-day
 * breakdown, see its own local-mode branch), so there's nothing accurate to
 * report here for that case. The stats page falls back to its previous
 * archivedAt-based heuristic when this returns null rather than showing an
 * empty heatmap for anonymous users.
 */
import type { ReadingActivityResponse } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

export async function loadReadingActivity(authenticated: boolean): Promise<ReadingActivityResponse | null> {
  if (!authenticated) return null;
  return apiFetch<ReadingActivityResponse>("/api/stats/reading-activity");
}
