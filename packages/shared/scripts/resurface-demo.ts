import { scoreHighlight, selectHighlightsToResurface, type ResurfaceCandidate } from "../src/resurface";

// Fixed clock so scores/output are reproducible across runs.
const NOW = new Date("2026-07-24T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

// One candidate per rule the algorithm needs to demonstrate.
const candidates: (ResurfaceCandidate & { label: string })[] = [
  {
    label: "never surfaced, no note",
    id: "never-plain",
    lastSurfacedAt: null,
    hasAnnotation: false,
    lastFeedback: null,
    resurfaceArchivedAt: null,
  },
  {
    label: "never surfaced, has a note",
    id: "never-annotated",
    lastSurfacedAt: null,
    hasAnnotation: true,
    lastFeedback: null,
    resurfaceArchivedAt: null,
  },
  {
    label: "surfaced 30d ago, no note, no feedback",
    id: "old-plain",
    lastSurfacedAt: daysAgo(30),
    hasAnnotation: false,
    lastFeedback: null,
    resurfaceArchivedAt: null,
  },
  {
    label: "surfaced 30d ago, has a note",
    id: "old-annotated",
    lastSurfacedAt: daysAgo(30),
    hasAnnotation: true,
    lastFeedback: null,
    resurfaceArchivedAt: null,
  },
  {
    label: "surfaced 30d ago, marked FORGOT",
    id: "old-forgot",
    lastSurfacedAt: daysAgo(30),
    hasAnnotation: false,
    lastFeedback: "FORGOT",
    resurfaceArchivedAt: null,
  },
  {
    label: "surfaced 30d ago, marked REMEMBERED",
    id: "old-remembered",
    lastSurfacedAt: daysAgo(30),
    hasAnnotation: false,
    lastFeedback: "REMEMBERED",
    resurfaceArchivedAt: null,
  },
  {
    label: "surfaced 1d ago -- inside the anti-repeat window",
    id: "too-recent",
    lastSurfacedAt: daysAgo(1),
    hasAnnotation: false,
    lastFeedback: null,
    resurfaceArchivedAt: null,
  },
  {
    label: "archived from resurfacing",
    id: "archived",
    lastSurfacedAt: daysAgo(200),
    hasAnnotation: true,
    lastFeedback: "FORGOT",
    resurfaceArchivedAt: daysAgo(5),
  },
];

console.log("=== Scores (higher = more likely to be picked) ===\n");
for (const c of candidates) {
  const score = scoreHighlight(c, NOW);
  console.log(`${score.toFixed(1).padStart(7)}  ${c.label}`);
}

console.log("\n=== Eligibility check: pick 8 of 8, minDaysBetweenResurfacing=3 ===");
const picked = selectHighlightsToResurface(candidates, 8, { now: NOW, random: mulberry32(42) });
const pickedIds = new Set(picked.map((c) => c.id));
for (const c of candidates) {
  const status = c.resurfaceArchivedAt
    ? "excluded (archived)"
    : c.lastSurfacedAt && daysBetween(c.lastSurfacedAt, NOW) < 3
      ? "excluded (too recent)"
      : pickedIds.has(c.id)
        ? "eligible, selected"
        : "eligible, not selected";
  console.log(`  ${status.padEnd(22)} ${c.label}`);
}

console.log("\n=== Weighted-random check: pick 3, 2000 trials, count selection frequency ===");
const counts = new Map<string, number>();
for (let i = 0; i < 2000; i++) {
  const trial = selectHighlightsToResurface(candidates, 3, { now: NOW });
  for (const c of trial) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
}
const eligible = candidates.filter((c) => !c.resurfaceArchivedAt && !(c.lastSurfacedAt && daysBetween(c.lastSurfacedAt, NOW) < 3));
for (const c of eligible) {
  const pct = (((counts.get(c.id) ?? 0) / 2000) * 100).toFixed(1);
  console.log(`  ${pct.padStart(5)}% of trials  ${c.label}`);
}
console.log(
  "\nExpect: never-surfaced and FORGOT-marked highlights picked most often; REMEMBERED picked least; excluded ones never appear.",
);

function daysBetween(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

// Tiny seeded RNG so the single deterministic pick above is reproducible run-to-run.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
