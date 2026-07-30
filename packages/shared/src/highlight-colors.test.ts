import { describe, expect, it } from "vitest";
import {
  CURATED_HIGHLIGHT_PALETTE,
  DEFAULT_HIGHLIGHT_BAR_COLORS,
  MAX_HIGHLIGHT_BAR_COLORS,
  highlightColorHex,
  highlightColorRgba,
  isLegacyHighlightColor,
  isValidHexColor,
  isValidHighlightColor,
  sanitizeHighlightBarColors,
} from "./highlight-colors";

describe("isValidHexColor", () => {
  it("accepts a real 6-digit hex", () => {
    expect(isValidHexColor("#F3DE9C")).toBe(true);
    expect(isValidHexColor("#000000")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidHexColor("YELLOW")).toBe(false);
    expect(isValidHexColor("#FFF")).toBe(false); // 3-digit shorthand not supported
    expect(isValidHexColor("#GGGGGG")).toBe(false);
    expect(isValidHexColor("red")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("isLegacyHighlightColor / isValidHighlightColor", () => {
  it("recognizes all five legacy names", () => {
    for (const name of ["YELLOW", "GREEN", "BLUE", "PINK", "ORANGE"]) {
      expect(isLegacyHighlightColor(name)).toBe(true);
      expect(isValidHighlightColor(name)).toBe(true);
    }
  });

  it("accepts a valid custom hex as a highlight color, but not a legacy name", () => {
    expect(isValidHighlightColor("#123ABC")).toBe(true);
    expect(isLegacyHighlightColor("#123ABC")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidHighlightColor("PURPLE")).toBe(false); // a curated-palette label, not a legacy id
    expect(isValidHighlightColor("not-a-color")).toBe(false);
  });
});

describe("highlightColorHex", () => {
  it("resolves a legacy name to its reference hex", () => {
    expect(highlightColorHex("YELLOW")).toBe("#F3DE9C");
  });

  it("passes a hex value through unchanged", () => {
    expect(highlightColorHex("#ABCDEF")).toBe("#ABCDEF");
  });
});

describe("highlightColorRgba", () => {
  it("converts a legacy color's reference hex to rgba", () => {
    expect(highlightColorRgba("YELLOW", 0.55)).toBe("rgba(243, 222, 156, 0.55)");
  });

  it("converts a custom hex to rgba", () => {
    expect(highlightColorRgba("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
    expect(highlightColorRgba("#FFFFFF", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });
});

describe("sanitizeHighlightBarColors", () => {
  it("falls back to the default set for non-array input", () => {
    expect(sanitizeHighlightBarColors(undefined)).toEqual(DEFAULT_HIGHLIGHT_BAR_COLORS);
    expect(sanitizeHighlightBarColors("YELLOW")).toEqual(DEFAULT_HIGHLIGHT_BAR_COLORS);
    expect(sanitizeHighlightBarColors(null)).toEqual(DEFAULT_HIGHLIGHT_BAR_COLORS);
  });

  it("drops invalid entries and dedupes, keeping valid ones", () => {
    expect(sanitizeHighlightBarColors(["YELLOW", "not-a-color", "YELLOW", "#123456"])).toEqual([
      "YELLOW",
      "#123456",
    ]);
  });

  it("falls back to the default set if nothing valid survives", () => {
    expect(sanitizeHighlightBarColors(["nope", 42, {}])).toEqual(DEFAULT_HIGHLIGHT_BAR_COLORS);
  });

  it("caps at MAX_HIGHLIGHT_BAR_COLORS", () => {
    const tooMany = CURATED_HIGHLIGHT_PALETTE.map((c) => c.id).concat(
      Array.from({ length: 10 }, (_, i) => `#${(100000 + i).toString(16).padStart(6, "0")}`),
    );
    expect(sanitizeHighlightBarColors(tooMany).length).toBe(MAX_HIGHLIGHT_BAR_COLORS);
  });
});
