import { describe, expect, it } from "vitest";
import { computeTextPosition, resolveTextPosition } from "./highlight-anchor";

describe("computeTextPosition", () => {
  it("captures exact text plus surrounding context", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const position = computeTextPosition(text, 4, 9); // "quick"
    expect(position.exact).toBe("quick");
    expect(position.start).toBe(4);
    expect(position.end).toBe(9);
    expect(position.prefix).toBe(text.slice(0, 4));
    expect(position.suffix).toBe(text.slice(9, 9 + 32));
  });
});

describe("resolveTextPosition", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  const original = computeTextPosition(text, 4, 9); // "quick"

  it("fast-paths when the offsets still match exactly", () => {
    const result = resolveTextPosition(text, original);
    expect(result).toEqual({ status: "resolved", start: 4, end: 9, driftedOffsets: false });
  });

  it("re-finds the text via prefix+exact+suffix when offsets have drifted", () => {
    const shifted = "Well, " + text; // everything shifted right by 6
    const result = resolveTextPosition(shifted, original);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.driftedOffsets).toBe(true);
      expect(shifted.slice(result.start, result.end)).toBe("quick");
    }
  });

  it("falls back to a bare search for `exact` when context no longer matches, picking the closest match", () => {
    // Suffix changed ("over" -> "above"), but there are two "quick"s -- the
    // bare-search fallback should pick whichever is closest to the original offset.
    const changed = "quick! The quick brown fox jumps above the lazy dog.";
    const result = resolveTextPosition(changed, original);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.driftedOffsets).toBe(true);
      // Closest to original start=4 is the first "quick" at index 0, not the second at index 11.
      expect(result.start).toBe(0);
    }
  });

  it("reports unresolved when the text is gone entirely", () => {
    const result = resolveTextPosition("Completely different content.", original);
    expect(result).toEqual({ status: "unresolved" });
  });
});
