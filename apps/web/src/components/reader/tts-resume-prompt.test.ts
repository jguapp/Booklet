/**
 * The resume decision (#152).
 *
 * These two functions are the whole "offered, not forced" behavior: whether a
 * stored position is worth surfacing at all, and how it is described. Both are
 * pure and both are easy to get subtly wrong in ways that are invisible until
 * a user is annoyed by them -- a prompt on every never-played article, or an
 * offer to resume to the last four seconds of something already finished.
 */
import { describe, expect, it } from "vitest";
import { describePosition, isResumable } from "./tts-resume-prompt";

describe("isResumable", () => {
  it("rejects a position that was never recorded", () => {
    // The distinction the nullable column exists for: never listened is not
    // the same as listened-and-paused-at-the-start.
    expect(isResumable(null)).toBe(false);
  });

  it("rejects a position indistinguishable from the start", () => {
    expect(isResumable(0)).toBe(false);
    expect(isResumable(0.009)).toBe(false);
  });

  it("rejects a position at the very end", () => {
    // Already finished -- resuming to the last moments is worse than starting
    // over, and the article is about to end either way.
    expect(isResumable(0.99)).toBe(false);
    expect(isResumable(1)).toBe(false);
  });

  it("accepts a genuine mid-article position", () => {
    expect(isResumable(0.01)).toBe(true);
    expect(isResumable(0.5)).toBe(true);
    expect(isResumable(0.98)).toBe(true);
  });

  it("rejects non-finite values rather than rendering NaN at the user", () => {
    // A corrupt local record or a bad server response should degrade to "no
    // prompt", not to "Resume listening from NaN% in?".
    expect(isResumable(Number.NaN)).toBe(false);
    expect(isResumable(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("describePosition", () => {
  it("prefers minutes, which read as a position", () => {
    expect(describePosition(0.5, 20)).toBe("about 10 min in");
  });

  it("falls back to a percentage with no reading-time estimate", () => {
    expect(describePosition(0.37, null)).toBe("37% in");
  });

  it("falls back to a percentage rather than saying '0 min in'", () => {
    // 2% of a 10-minute article rounds to 0 minutes; a zero here would read as
    // "you're at the beginning", which is exactly what it isn't.
    expect(describePosition(0.02, 10)).toBe("2% in");
  });

  it("ignores a zero or missing estimate", () => {
    expect(describePosition(0.5, 0)).toBe("50% in");
  });
});
