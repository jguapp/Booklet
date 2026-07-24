import type { Highlight } from "@booklet/shared";

/**
 * Stand-in for the real POST /api/.../highlights persistence until that route
 * exists (see the "frontend-only, mock data" decision for this pass). Swap
 * this module out, not the Reader view, once the real API lands.
 */
const STORAGE_KEY = "booklet-mock-highlights";

export function loadPersistedHighlights(fallback: Highlight[]): Highlight[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Highlight[]) : fallback;
  } catch {
    return fallback;
  }
}

export function savePersistedHighlights(highlights: Highlight[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(highlights));
  } catch {
    // best-effort only
  }
}
