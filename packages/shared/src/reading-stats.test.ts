import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeReadingStats, type ReadingStatsCandidate } from "./reading-stats";

function article(archivedAt: string | null, activeReadingSeconds = 0): ReadingStatsCandidate {
  return { archivedAt, activeReadingSeconds };
}

describe("computeReadingStats", () => {
  it("returns zeroed stats for an empty library, not NaN", () => {
    const stats = computeReadingStats([]);
    expect(stats).toEqual({
      currentStreakDays: 0,
      longestStreakDays: 0,
      totalReadingSeconds: 0,
      completionRate: 0,
      totalArticles: 0,
      finishedArticles: 0,
    });
  });

  it("sums activeReadingSeconds across every article, finished or not", () => {
    const stats = computeReadingStats([article(null, 120), article("2026-01-01T00:00:00Z", 300)]);
    expect(stats.totalReadingSeconds).toBe(420);
  });

  it("computes completion rate as finished / total", () => {
    const stats = computeReadingStats([
      article("2026-01-01T00:00:00Z"),
      article("2026-01-01T00:00:00Z"),
      article(null),
      article(null),
    ]);
    expect(stats.completionRate).toBe(0.5);
    expect(stats.finishedArticles).toBe(2);
    expect(stats.totalArticles).toBe(4);
  });

  it("counts a streak of consecutive days with something finished, including today", () => {
    const now = new Date("2026-01-10T12:00:00");
    const stats = computeReadingStats(
      [
        article(new Date("2026-01-10T09:00:00").toISOString()),
        article(new Date("2026-01-09T09:00:00").toISOString()),
        article(new Date("2026-01-08T09:00:00").toISOString()),
      ],
      now,
    );
    expect(stats.currentStreakDays).toBe(3);
  });

  it("doesn't break the streak just because nothing is finished yet today", () => {
    const now = new Date("2026-01-10T08:00:00"); // early -- hasn't read today yet
    const stats = computeReadingStats(
      [article(new Date("2026-01-09T09:00:00").toISOString()), article(new Date("2026-01-08T09:00:00").toISOString())],
      now,
    );
    expect(stats.currentStreakDays).toBe(2);
  });

  it("resets to 0 once a day is actually skipped", () => {
    const now = new Date("2026-01-10T12:00:00");
    const stats = computeReadingStats(
      [article(new Date("2026-01-10T09:00:00").toISOString()), article(new Date("2026-01-07T09:00:00").toISOString())],
      now,
    );
    expect(stats.currentStreakDays).toBe(1);
  });

  it("multiple finishes on the same day only count once toward the streak", () => {
    const now = new Date("2026-01-10T12:00:00");
    const stats = computeReadingStats(
      [
        article(new Date("2026-01-10T09:00:00").toISOString()),
        article(new Date("2026-01-10T15:00:00").toISOString()),
      ],
      now,
    );
    expect(stats.currentStreakDays).toBe(1);
  });

  it("longest streak remembers a past run even after it's been broken", () => {
    const now = new Date("2026-01-20T12:00:00");
    const stats = computeReadingStats(
      [
        // A 4-day run early in the month...
        article(new Date("2026-01-01T09:00:00").toISOString()),
        article(new Date("2026-01-02T09:00:00").toISOString()),
        article(new Date("2026-01-03T09:00:00").toISOString()),
        article(new Date("2026-01-04T09:00:00").toISOString()),
        // ...then a gap, then a shorter 2-day run right up to `now`.
        article(new Date("2026-01-19T09:00:00").toISOString()),
        article(new Date("2026-01-20T09:00:00").toISOString()),
      ],
      now,
    );
    expect(stats.currentStreakDays).toBe(2);
    expect(stats.longestStreakDays).toBe(4);
  });

  it("longest streak equals the current streak when it's the best one so far", () => {
    const now = new Date("2026-01-10T12:00:00");
    const stats = computeReadingStats(
      [
        article(new Date("2026-01-10T09:00:00").toISOString()),
        article(new Date("2026-01-09T09:00:00").toISOString()),
        article(new Date("2026-01-08T09:00:00").toISOString()),
      ],
      now,
    );
    expect(stats.longestStreakDays).toBe(3);
  });
});

/**
 * Streaks are counted in *local* calendar days (startOfDay uses local
 * getFullYear/getMonth/getDate), and this function used to step between them
 * by subtracting a fixed 86,400,000ms. Consecutive local midnights are 23 or
 * 25 hours apart across a DST transition, so the step landed an hour off and
 * matched nothing: the streak silently reset for every reader in a DST
 * timezone, twice a year.
 *
 * process.env.TZ is set here rather than in the runner config so the rest of
 * the suite keeps running in whatever the machine's timezone is -- these are
 * the only cases that care, and the bug is invisible from UTC.
 */
describe("streaks across a DST transition", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("counts through spring-forward instead of resetting", () => {
    // 8 March 2026 is the US spring-forward: 2am local never happens, so
    // local midnight on the 9th is 23 hours after local midnight on the 8th.
    const now = new Date("2026-03-09T18:00:00Z"); // afternoon of the 9th, local
    const stats = computeReadingStats(
      [
        article("2026-03-06T15:00:00Z"),
        article("2026-03-07T15:00:00Z"),
        article("2026-03-08T15:00:00Z"),
        article("2026-03-09T15:00:00Z"),
      ],
      now,
    );
    // Was 1 (the streak died the moment it tried to step back past the
    // transition) and 3.
    expect(stats.currentStreakDays).toBe(4);
    expect(stats.longestStreakDays).toBe(4);
  });

  it("counts through fall-back instead of double-counting or resetting", () => {
    // 1 November 2026 is the US fall-back: that local day is 25 hours long.
    const now = new Date("2026-11-02T18:00:00Z");
    const stats = computeReadingStats(
      [
        article("2026-10-30T15:00:00Z"),
        article("2026-10-31T15:00:00Z"),
        article("2026-11-01T15:00:00Z"),
        article("2026-11-02T15:00:00Z"),
      ],
      now,
    );
    expect(stats.currentStreakDays).toBe(4);
    expect(stats.longestStreakDays).toBe(4);
  });
});
