import { describe, expect, it } from "vitest";
import { computeRecap, type RecapCandidate } from "./recap";

function article(overrides: Partial<RecapCandidate> = {}): RecapCandidate {
  return {
    savedAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    activeReadingSeconds: 0,
    tags: [],
    ...overrides,
  };
}

describe("computeRecap", () => {
  const now = new Date("2026-01-15T12:00:00Z");

  it("counts articles saved within the last week, excluding older ones", () => {
    const recap = computeRecap(
      [
        article({ savedAt: "2026-01-14T00:00:00Z" }), // within the week
        article({ savedAt: "2026-01-01T00:00:00Z" }), // too old
      ],
      "week",
      now,
    );
    expect(recap.articlesSaved).toBe(1);
  });

  it("counts articles finished within the period, and sums their reading time", () => {
    const recap = computeRecap(
      [
        article({ archivedAt: "2026-01-14T00:00:00Z", activeReadingSeconds: 300 }),
        article({ archivedAt: "2026-01-14T00:00:00Z", activeReadingSeconds: 200 }),
        article({ archivedAt: "2025-12-01T00:00:00Z", activeReadingSeconds: 999 }), // too old, excluded
        article({ archivedAt: null, activeReadingSeconds: 500 }), // never finished, excluded
      ],
      "week",
      now,
    );
    expect(recap.articlesFinished).toBe(2);
    expect(recap.timeSpentSeconds).toBe(500);
  });

  it("ranks top tags across saved and finished articles in the period", () => {
    const recap = computeRecap(
      [
        article({ savedAt: "2026-01-14T00:00:00Z", tags: ["a", "b"] }),
        article({ savedAt: "2026-01-13T00:00:00Z", tags: ["a"] }),
        article({ savedAt: "2026-01-01T00:00:00Z", tags: ["c"] }), // outside period, excluded
      ],
      "week",
      now,
    );
    expect(recap.topTags[0]).toEqual({ tag: "a", count: 2 });
  });

  it("uses a month-long window for the month period", () => {
    const recap = computeRecap(
      [article({ savedAt: "2026-01-01T00:00:00Z" })], // 14 days ago -- inside a month, outside a week
      "month",
      now,
    );
    expect(recap.articlesSaved).toBe(1);
  });

  it("carries the overall streak, not a period-limited one", () => {
    const recap = computeRecap(
      [
        article({ archivedAt: "2026-01-15T00:00:00Z" }),
        article({ archivedAt: "2026-01-14T00:00:00Z" }),
        article({ archivedAt: "2026-01-13T00:00:00Z" }),
      ],
      "week",
      now,
    );
    expect(recap.currentStreakDays).toBe(3);
    expect(recap.longestStreakDays).toBe(3);
  });
});
