import { describe, expect, it } from "vitest";
import {
  applySm2Review,
  DEFAULT_SM2_STATE,
  feedbackToQuality,
  selectHighlightsToResurface,
  type ResurfaceCandidate,
} from "./resurface";

describe("applySm2Review", () => {
  it("starts a never-reviewed highlight at a 1-day interval on recall", () => {
    const result = applySm2Review(DEFAULT_SM2_STATE, feedbackToQuality("REMEMBERED"), new Date("2026-01-01"));
    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(1);
    expect(result.nextDueAt).toBe(new Date("2026-01-02").toISOString());
  });

  it("grows the interval on consecutive recalls: 1d -> 6d -> interval*EF", () => {
    let state = DEFAULT_SM2_STATE;
    const now = new Date("2026-01-01");

    const r1 = applySm2Review(state, feedbackToQuality("REMEMBERED"), now);
    expect(r1.intervalDays).toBe(1);
    state = r1;

    const r2 = applySm2Review(state, feedbackToQuality("REMEMBERED"), now);
    expect(r2.intervalDays).toBe(6);
    state = r2;

    const r3 = applySm2Review(state, feedbackToQuality("REMEMBERED"), now);
    // 6 * 2.5 (EF unchanged at quality 4) = 15
    expect(r3.intervalDays).toBe(15);
  });

  it("keeps the easiness factor unchanged at quality 4 (REMEMBERED)", () => {
    const result = applySm2Review(DEFAULT_SM2_STATE, feedbackToQuality("REMEMBERED"));
    expect(result.easinessFactor).toBeCloseTo(2.5, 5);
  });

  it("resets interval and repetitions to 0 on a miss (FORGOT), and lowers the easiness factor", () => {
    const reviewed = applySm2Review(DEFAULT_SM2_STATE, feedbackToQuality("REMEMBERED"));
    const forgot = applySm2Review(reviewed, feedbackToQuality("FORGOT"));
    expect(forgot.intervalDays).toBe(1);
    expect(forgot.repetitions).toBe(0);
    expect(forgot.easinessFactor).toBeLessThan(reviewed.easinessFactor);
  });

  /**
   * SM-2's interval multiplies without bound, and the result is written into
   * `Highlight.intervalDays`, a Postgres `Int`. Confirmed by running the
   * recurrence out at quality 4: review 20 produces ~3.5 billion days (past
   * Int4's 2,147,483,647, so the write is rejected) and review 21 threw
   * "RangeError: Invalid time value" out of `new Date(...).toISOString()` --
   * a bare throw from a pure function, on the client, while recording a
   * review the reader had already given.
   */
  it("caps a long recall streak instead of overflowing the column and then Date", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    let reviewed = applySm2Review(DEFAULT_SM2_STATE, feedbackToQuality("REMEMBERED"), now);

    for (let review = 2; review <= 40; review++) {
      reviewed = applySm2Review(reviewed, feedbackToQuality("REMEMBERED"), now);
      // Postgres Int4. Was exceeded around review 20.
      expect(reviewed.intervalDays).toBeLessThanOrEqual(2_147_483_647);
      // Was a RangeError from review 21 onwards.
      expect(Number.isNaN(new Date(reviewed.nextDueAt).getTime())).toBe(false);
    }

    expect(reviewed.intervalDays).toBe(36_500);
  });

  it("never lets the easiness factor drop below 1.3", () => {
    let state = DEFAULT_SM2_STATE;
    for (let i = 0; i < 50; i++) {
      state = applySm2Review(state, feedbackToQuality("FORGOT"));
    }
    expect(state.easinessFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe("selectHighlightsToResurface", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");

  function daysFromNow(n: number): string {
    return new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();
  }

  it("includes never-reviewed highlights (nextDueAt: null)", () => {
    const candidates: ResurfaceCandidate[] = [{ id: "a", nextDueAt: null, resurfaceArchivedAt: null }];
    const result = selectHighlightsToResurface(candidates, 10, { now });
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("includes overdue highlights and excludes not-yet-due ones", () => {
    const candidates: ResurfaceCandidate[] = [
      { id: "overdue", nextDueAt: daysFromNow(-1), resurfaceArchivedAt: null },
      { id: "future", nextDueAt: daysFromNow(1), resurfaceArchivedAt: null },
    ];
    const result = selectHighlightsToResurface(candidates, 10, { now });
    expect(result.map((c) => c.id)).toEqual(["overdue"]);
  });

  it("excludes archived highlights regardless of due date", () => {
    const candidates: ResurfaceCandidate[] = [
      { id: "archived", nextDueAt: null, resurfaceArchivedAt: daysFromNow(-1) },
    ];
    expect(selectHighlightsToResurface(candidates, 10, { now })).toHaveLength(0);
  });

  it("orders most-overdue first, never-reviewed before any dated one", () => {
    const candidates: ResurfaceCandidate[] = [
      { id: "due-soon", nextDueAt: daysFromNow(-1), resurfaceArchivedAt: null },
      { id: "never", nextDueAt: null, resurfaceArchivedAt: null },
      { id: "very-overdue", nextDueAt: daysFromNow(-30), resurfaceArchivedAt: null },
    ];
    const result = selectHighlightsToResurface(candidates, 10, { now });
    expect(result.map((c) => c.id)).toEqual(["never", "very-overdue", "due-soon"]);
  });

  it("caps the result at `count`", () => {
    const candidates: ResurfaceCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `h${i}`,
      nextDueAt: null,
      resurfaceArchivedAt: null,
    }));
    expect(selectHighlightsToResurface(candidates, 2, { now })).toHaveLength(2);
  });
});
