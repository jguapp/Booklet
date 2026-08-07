import { describe, expect, it } from "vitest";
import { hasScrolledAway } from "./highlight-popover";

/**
 * Regression cover for the last intermittent failure in the re-enabled e2e
 * suite (highlight-citations.spec.ts, timing out on the colour picker).
 *
 * The popover dismissed itself on *any* window scroll event. But "a scroll
 * event arrived" and "the page has moved since this opened" are different
 * things: a scroll event can be dispatched a frame or more after the
 * scrolling that caused it -- a programmatic scrollIntoView, or ordinary
 * momentum scrolling, which keeps emitting for hundreds of milliseconds
 * after the fingers leave the trackpad. Either can land just after the
 * popover mounts, for scrolling that finished before it existed, closing the
 * popover the reader just opened.
 *
 * It reproduced about one run in three and cost a full e2e cycle to find.
 * These run in microseconds.
 */
describe("hasScrolledAway", () => {
  it("is false for an event reporting the position the page is already at", () => {
    expect(hasScrolledAway(500, 500)).toBe(false);
  });

  it("is false for sub-threshold jitter", () => {
    expect(hasScrolledAway(500, 502)).toBe(false);
    expect(hasScrolledAway(500, 498)).toBe(false);
  });

  it("is true for a real scroll down", () => {
    expect(hasScrolledAway(500, 900)).toBe(true);
  });

  it("is true for a real scroll up", () => {
    expect(hasScrolledAway(500, 100)).toBe(true);
  });

  it("measures from where the popover opened, not from the top of the page", () => {
    // Comparing against 0 instead of the mount position would dismiss
    // instantly on any deep-scrolled page -- which is most of them, since
    // you have to scroll to reach the text you want to highlight.
    expect(hasScrolledAway(5000, 5000)).toBe(false);
    expect(hasScrolledAway(5000, 5400)).toBe(true);
  });

  it("is exclusive at exactly the threshold", () => {
    expect(hasScrolledAway(0, 8)).toBe(false);
    expect(hasScrolledAway(0, 9)).toBe(true);
  });
});
