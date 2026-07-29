import { describe, expect, it } from "vitest";
import { computeReadingStats, type ReadingStatsCandidate } from "./reading-stats";

function article(archivedAt: string | null, activeReadingSeconds = 0): ReadingStatsCandidate {
  return { archivedAt, activeReadingSeconds };
}

describe("computeReadingStats", () => {
  it("returns zeroed stats for an empty library, not NaN", () => {
    const stats = computeReadingStats([]);
    expect(stats).toEqual({
      currentStreakDays: 0,
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
});
