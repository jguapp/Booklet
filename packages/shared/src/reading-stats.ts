const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Minimal shape the calculation needs -- deliberately not the full Article,
 * so this stays a pure function callers can unit-test with plain objects
 * instead of a database. Trash should already be excluded by the caller
 * (loadArticles() already does).
 */
export interface ReadingStatsCandidate {
  archivedAt: string | null;
  activeReadingSeconds: number;
}

export interface ReadingStats {
  /** Consecutive days (including today, if something was already finished
   * today) with at least one article finished. */
  currentStreakDays: number;
  totalReadingSeconds: number;
  /** 0-1. 0 when there's nothing saved yet, not NaN. */
  completionRate: number;
  totalArticles: number;
  finishedArticles: number;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Finished" means archived -- see reader-view.tsx's auto-archive-on-finish
 * and the library's manual Archive action, both of which set archivedAt.
 * Pure and side-effect-free; `now` is injectable for reproducible tests.
 */
export function computeReadingStats(articles: ReadingStatsCandidate[], now: Date = new Date()): ReadingStats {
  const totalArticles = articles.length;
  const finished = articles.filter((a) => a.archivedAt !== null);
  const finishedArticles = finished.length;
  const completionRate = totalArticles > 0 ? finishedArticles / totalArticles : 0;
  const totalReadingSeconds = articles.reduce((sum, a) => sum + a.activeReadingSeconds, 0);

  const finishedDayStarts = new Set(finished.map((a) => startOfDay(new Date(a.archivedAt!))));
  const today = startOfDay(now);
  // Nothing finished yet today doesn't break a streak that ended
  // yesterday -- today isn't over. It just doesn't count towards it either.
  let cursor = finishedDayStarts.has(today) ? today : today - DAY_MS;
  let currentStreakDays = 0;
  while (finishedDayStarts.has(cursor)) {
    currentStreakDays++;
    cursor -= DAY_MS;
  }

  return { currentStreakDays, totalReadingSeconds, completionRate, totalArticles, finishedArticles };
}
