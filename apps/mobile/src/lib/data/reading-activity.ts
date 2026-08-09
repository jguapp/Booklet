/**
 * Real per-day reading activity for the Stats heatmap -- mirrors the web
 * app's lib/data/reading-activity.ts. Signed-in only: local mode has no
 * per-day history to ask for (mobile doesn't track reading time at all
 * yet), so StatsScreen falls back to its archivedAt-based heuristic when
 * this returns null, same as the web page.
 */
import type { ReadingActivityResponse } from "@booklet/shared";
import { apiFetch } from "../api";

export async function loadReadingActivity(authenticated: boolean): Promise<ReadingActivityResponse | null> {
  if (!authenticated) return null;
  return apiFetch<ReadingActivityResponse>("/api/stats/reading-activity");
}
