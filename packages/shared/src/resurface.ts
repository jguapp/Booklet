import type { ResurfaceFeedback } from "./types/highlight";

export type ResurfaceFrequency = "DAILY" | "WEEKLY";

const DAY_MS = 1000 * 60 * 60 * 24;
const MIN_EASINESS_FACTOR = 1.3;
const DEFAULT_EASINESS_FACTOR = 2.5;

/**
 * Ceiling on the computed interval. A hundred years.
 *
 * SM-2's interval is `previous * easinessFactor` and nothing in it converges,
 * so on a long streak of REMEMBERED it grows without limit -- and it is
 * written straight into `Highlight.intervalDays`, which is a Postgres `Int`.
 * Traced by running the recurrence out (all quality 4, the value the UI's
 * REMEMBERED maps to):
 *
 *   review 9    3,720 days      review 15      908,208 days
 *   review 18   14,190,750      review 20    ~3.5 billion  <- past Int4's
 *                                                             2,147,483,647
 *   review 21   `new Date(...).toISOString()` throws
 *               "RangeError: Invalid time value"
 *
 * So the two failures are a write that the database rejects, and then a bare
 * RangeError out of a pure function that every caller treats as total. The
 * second one is the worse of the two: it is thrown while recording a review
 * the reader has already given, on the client, from a function whose whole
 * contract is that it just returns the next state.
 *
 * Capping rather than clamping at Int4's own maximum, because a highlight due
 * in 5.8 million years and one due in a hundred years are the same highlight
 * -- neither will ever come up again -- while 2,147,483,647 is a number
 * chosen by a column type, and `now + 2.1 billion days` overflows Date
 * anyway. A hundred years is comfortably beyond any real review horizon,
 * survives the round trip through both the column and Date, and is reached
 * only after ~14 consecutive recalls, by which point the schedule has long
 * since stopped meaning anything.
 */
const MAX_INTERVAL_DAYS = 36_500;

export interface Sm2State {
  easinessFactor: number;
  intervalDays: number;
  repetitions: number;
}

export const DEFAULT_SM2_STATE: Sm2State = {
  easinessFactor: DEFAULT_EASINESS_FACTOR,
  intervalDays: 0,
  repetitions: 0,
};

/** REMEMBERED/FORGOT is all the UI collects -- mapped to SM-2's 0-5 quality scale. */
export function feedbackToQuality(feedback: ResurfaceFeedback): 2 | 4 {
  return feedback === "REMEMBERED" ? 4 : 2;
}

/**
 * The SM-2 spaced-repetition algorithm (SuperMemo 2, Wozniak 1987): quality
 * >= 3 grows the interval (1 day -> 6 days -> previous interval * easiness
 * factor) and nudges the easiness factor up or down based on how easy that
 * recall was; quality < 3 resets the streak to a 1-day interval. Pure and
 * side-effect-free -- callers persist the result (Highlight.easinessFactor/
 * intervalDays/repetitions/nextDueAt) and pass it back in as `state` next time.
 */
export function applySm2Review(
  state: Sm2State,
  quality: 0 | 1 | 2 | 3 | 4 | 5,
  now: Date = new Date(),
): Sm2State & { nextDueAt: string } {
  let { easinessFactor, intervalDays, repetitions } = state;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalDays * easinessFactor));
    repetitions += 1;
  }

  easinessFactor = Math.max(
    MIN_EASINESS_FACTOR,
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  const nextDueAt = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();

  return { easinessFactor, intervalDays, repetitions, nextDueAt };
}

/**
 * Minimal shape the selection algorithm needs -- deliberately not the full
 * Highlight row, so this stays a pure function callers can unit-test with
 * plain objects instead of a database.
 */
export interface ResurfaceCandidate {
  id: string;
  /** null = never reviewed, due immediately. */
  nextDueAt: string | null;
  resurfaceArchivedAt: string | null;
}

export interface ResurfaceOptions {
  /** Defaults to `new Date()`. Inject a fixed date for reproducible tests. */
  now?: Date;
}

function isDue(candidate: ResurfaceCandidate, now: Date): boolean {
  if (candidate.resurfaceArchivedAt !== null) return false;
  if (candidate.nextDueAt === null) return true;
  return new Date(candidate.nextDueAt).getTime() <= now.getTime();
}

/**
 * Pick up to `count` due highlights to resurface, most-overdue first. Real
 * SM-2 scheduling (see applySm2Review) replaced the earlier weighted-random
 * heuristic here -- "resurface" now means "show me what's actually due,"
 * not "show me something plausible."
 */
export function selectHighlightsToResurface(
  candidates: ResurfaceCandidate[],
  count: number,
  options: ResurfaceOptions = {},
): ResurfaceCandidate[] {
  const now = options.now ?? new Date();

  return candidates
    .filter((c) => isDue(c, now))
    .sort((a, b) => {
      // Never-reviewed (null) sorts as "most overdue" -- before any dated one.
      if (a.nextDueAt === null && b.nextDueAt === null) return 0;
      if (a.nextDueAt === null) return -1;
      if (b.nextDueAt === null) return 1;
      return new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime();
    })
    .slice(0, count);
}
