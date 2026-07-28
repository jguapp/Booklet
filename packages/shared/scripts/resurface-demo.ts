import {
  applySm2Review,
  DEFAULT_SM2_STATE,
  feedbackToQuality,
  selectHighlightsToResurface,
  type ResurfaceCandidate,
  type Sm2State,
} from "../src/resurface";

// Fixed clock so output is reproducible across runs.
const NOW = new Date("2026-07-24T12:00:00.000Z");

function daysFromNow(n: number): string {
  return new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();
}

console.log("=== Selection: due vs. not-yet-due vs. archived ===\n");
const candidates: (ResurfaceCandidate & { label: string })[] = [
  { label: "never reviewed", id: "never", nextDueAt: null, resurfaceArchivedAt: null },
  { label: "overdue by 10 days", id: "overdue-10", nextDueAt: daysFromNow(-10), resurfaceArchivedAt: null },
  { label: "overdue by 2 days", id: "overdue-2", nextDueAt: daysFromNow(-2), resurfaceArchivedAt: null },
  { label: "due tomorrow", id: "not-yet-due", nextDueAt: daysFromNow(1), resurfaceArchivedAt: null },
  { label: "archived from resurfacing", id: "archived", nextDueAt: daysFromNow(-100), resurfaceArchivedAt: daysFromNow(-1) },
];

const selected = selectHighlightsToResurface(candidates, 8, { now: NOW });
const selectedIds = new Set(selected.map((c) => c.id));
for (const c of candidates) {
  const status = c.resurfaceArchivedAt ? "excluded (archived)" : selectedIds.has(c.id) ? "selected" : "not due yet";
  console.log(`  ${status.padEnd(20)} ${c.label}`);
}
console.log("\nOrder returned (most overdue first):", selected.map((c) => c.id).join(", "));

console.log("\n=== SM-2 progression: a highlight reviewed 4 times, always REMEMBERED ===\n");
let state: Sm2State = DEFAULT_SM2_STATE;
let reviewDate = NOW;
for (let review = 1; review <= 4; review++) {
  const result = applySm2Review(state, feedbackToQuality("REMEMBERED"), reviewDate);
  console.log(
    `  review ${review}: interval=${result.intervalDays}d  EF=${result.easinessFactor.toFixed(2)}  next due=${result.nextDueAt.slice(0, 10)}`,
  );
  state = result;
  reviewDate = new Date(result.nextDueAt);
}

console.log("\n=== SM-2 reset: same highlight, then FORGOT ===\n");
const forgotResult = applySm2Review(state, feedbackToQuality("FORGOT"), reviewDate);
console.log(
  `  after FORGOT: interval=${forgotResult.intervalDays}d (reset)  EF=${forgotResult.easinessFactor.toFixed(2)} (dropped)  repetitions=${forgotResult.repetitions} (reset)`,
);
