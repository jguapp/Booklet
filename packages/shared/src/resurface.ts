import type { ResurfaceFeedback } from "./types/highlight";

export type ResurfaceFrequency = "DAILY" | "WEEKLY";

/**
 * Minimal shape the selection algorithm needs -- deliberately not the full
 * Highlight row, so this stays a pure function callers can unit-test with
 * plain objects instead of a database.
 */
export interface ResurfaceCandidate {
  id: string;
  lastSurfacedAt: string | null;
  hasAnnotation: boolean;
  lastFeedback: ResurfaceFeedback | null;
  resurfaceArchivedAt: string | null;
}

export interface ResurfaceOptions {
  /** Defaults to `new Date()`. Inject a fixed date for reproducible tests. */
  now?: Date;
  /** Hard exclusion window -- don't reshow within this many days. Default 3. */
  minDaysBetweenResurfacing?: number;
  /** Defaults to `Math.random`. Inject a seeded RNG for reproducible tests. */
  random?: () => number;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const NEVER_SURFACED_DAYS = 365; // treat "never shown" as maximally overdue, not infinite
const ANNOTATION_BOOST = 1.3; // "more thought went into it"
const FORGOT_BOOST = 1.6; // resurface sooner
const REMEMBERED_DAMPEN = 0.6; // needed less urgently

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS;
}

function isEligible(candidate: ResurfaceCandidate, now: Date, minDays: number): boolean {
  if (candidate.resurfaceArchivedAt !== null) return false;
  if (candidate.lastSurfacedAt !== null && daysSince(candidate.lastSurfacedAt, now) < minDays) {
    return false;
  }
  return true;
}

/** Exported for testability/inspection -- higher score = more likely to be picked. */
export function scoreHighlight(candidate: ResurfaceCandidate, now: Date = new Date()): number {
  const recencyDays = candidate.lastSurfacedAt
    ? daysSince(candidate.lastSurfacedAt, now)
    : NEVER_SURFACED_DAYS;

  let score = Math.max(recencyDays, 0.1);

  if (candidate.hasAnnotation) score *= ANNOTATION_BOOST;
  if (candidate.lastFeedback === "FORGOT") score *= FORGOT_BOOST;
  else if (candidate.lastFeedback === "REMEMBERED") score *= REMEMBERED_DAMPEN;

  return score;
}

/** Weighted sample without replacement -- higher score = proportionally more likely, not guaranteed. */
function weightedPick<T>(items: T[], weights: number[], count: number, random: () => number): T[] {
  const pool = items.map((item, i) => ({ item, weight: weights[i] }));
  const picked: T[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = random() * totalWeight;
    let idx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) {
        idx = j;
        break;
      }
    }
    picked.push(pool[idx].item);
    pool.splice(idx, 1);
  }

  return picked;
}

/**
 * Pick up to `count` highlights to resurface. Start-simple strategy, not a
 * real SRS algorithm: eligibility is a hard filter (archived-from-resurfacing
 * or shown too recently are excluded outright), then eligible candidates are
 * weighted-randomly sampled by `scoreHighlight`. Swapping in SM-2 later means
 * replacing this function's body, not its callers -- `getHighlightsToResurface`
 * (apps/api) only depends on the signature, not how selection works inside it.
 */
export function selectHighlightsToResurface(
  candidates: ResurfaceCandidate[],
  count: number,
  options: ResurfaceOptions = {},
): ResurfaceCandidate[] {
  const now = options.now ?? new Date();
  const minDays = options.minDaysBetweenResurfacing ?? 3;
  const random = options.random ?? Math.random;

  const eligible = candidates.filter((c) => isEligible(c, now, minDays));
  const weights = eligible.map((c) => scoreHighlight(c, now));

  return weightedPick(eligible, weights, count, random);
}
