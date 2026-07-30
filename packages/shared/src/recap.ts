import { computeReadingStats, type ReadingStatsCandidate } from "./reading-stats";

export type RecapPeriod = "week" | "month";

/** Same minimal-shape-not-full-Article approach as ReadingStatsCandidate/
 * RelatedArticleCandidate -- pure, unit-testable without a database. */
export interface RecapCandidate extends ReadingStatsCandidate {
  savedAt: string;
  tags: string[];
}

export interface Recap {
  period: RecapPeriod;
  periodStart: string;
  articlesSaved: number;
  articlesFinished: number;
  /** Time spent on articles *finished* within the period -- activeReadingSeconds
   * is a lifetime running total per article, not bucketed by when the time
   * was actually spent, so "time spent this week" is a proxy (time spent on
   * whatever got finished this week), not literally time-of-day-accurate. */
  timeSpentSeconds: number;
  topTags: { tag: string; count: number }[];
  currentStreakDays: number;
  longestStreakDays: number;
}

function periodStartDate(period: RecapPeriod, now: Date): Date {
  const start = new Date(now);
  if (period === "week") {
    start.setDate(start.getDate() - 7);
  } else {
    start.setMonth(start.getMonth() - 1);
  }
  return start;
}

export function computeRecap(articles: RecapCandidate[], period: RecapPeriod, now: Date = new Date()): Recap {
  const start = periodStartDate(period, now);
  const startMs = start.getTime();
  const nowMs = now.getTime();

  const savedInPeriod = articles.filter((a) => {
    const t = new Date(a.savedAt).getTime();
    return t >= startMs && t <= nowMs;
  });
  const finishedInPeriod = articles.filter((a) => {
    if (!a.archivedAt) return false;
    const t = new Date(a.archivedAt).getTime();
    return t >= startMs && t <= nowMs;
  });

  const tagCounts = new Map<string, number>();
  for (const a of [...savedInPeriod, ...finishedInPeriod]) {
    for (const tag of a.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const overallStats = computeReadingStats(articles, now);

  return {
    period,
    periodStart: start.toISOString(),
    articlesSaved: savedInPeriod.length,
    articlesFinished: finishedInPeriod.length,
    timeSpentSeconds: finishedInPeriod.reduce((sum, a) => sum + a.activeReadingSeconds, 0),
    topTags,
    currentStreakDays: overallStats.currentStreakDays,
    longestStreakDays: overallStats.longestStreakDays,
  };
}
