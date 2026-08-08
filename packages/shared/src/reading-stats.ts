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
  /** The longest run of consecutive finish-days ever, which may be the
   * current streak itself (an ongoing streak still counts while it runs). */
  longestStreakDays: number;
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
 * The previous local calendar day's midnight.
 *
 * Not `timestamp - DAY_MS`, which is what this used to do everywhere below and
 * which is wrong for anyone outside a fixed-offset timezone. `startOfDay`
 * returns *local* midnight, and consecutive local midnights are 23 or 25 hours
 * apart across a DST transition, not 24 -- so subtracting a fixed 86,400,000
 * lands an hour to either side of the neighbouring day and matches nothing.
 *
 * Confirmed by hand rather than reasoned about: a reader in America/New_York
 * who finished something on the 6th, 7th, 8th and 9th of March 2026 (the 8th
 * is the spring-forward) got currentStreakDays 1 instead of 4 and
 * longestStreakDays 3 instead of 4. The same data in UTC gave 4 and 4. It
 * happens to every user in a DST timezone, twice a year, and it silently
 * destroys the streak the whole stats page is built around -- which reads as
 * "the app forgot my streak", not as a date bug.
 *
 * Stepping through the Date constructor instead means the arithmetic is done
 * in calendar days, which is the unit the question is actually about. Day 0 of
 * a month rolls back to the last day of the previous one, so month and year
 * boundaries need no special case.
 */
function previousDayStart(dayStart: number): number {
  const day = new Date(dayStart);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1).getTime();
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
  let cursor = finishedDayStarts.has(today) ? today : previousDayStart(today);
  let currentStreakDays = 0;
  while (finishedDayStarts.has(cursor)) {
    currentStreakDays++;
    cursor = previousDayStart(cursor);
  }

  // Longest run of consecutive days anywhere in history -- walk the
  // distinct finish-days in order and count consecutive-day runs. Only
  // needs to consider days that actually have a finish, since a gap of
  // any size breaks a run regardless of how long it is.
  const sortedDays = [...finishedDayStarts].sort((a, b) => a - b);
  let longestStreakDays = 0;
  let runLength = 0;
  let previousDay: number | null = null;
  for (const day of sortedDays) {
    // Same DST reasoning as previousDayStart: "is this the day after that
    // one?" is a calendar question, and `day - previousDay === DAY_MS` gets it
    // wrong by an hour on both transition days every year.
    runLength = previousDay !== null && previousDayStart(day) === previousDay ? runLength + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, runLength);
    previousDay = day;
  }

  return {
    currentStreakDays,
    longestStreakDays,
    totalReadingSeconds,
    completionRate,
    totalArticles,
    finishedArticles,
  };
}
