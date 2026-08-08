import { describe, expect, it } from "vitest";
import { MAX_RECALL_PROMPT_LENGTH, isValidRecallPrompt, normalizeRecallPrompt } from "./recall-prompt";

describe("normalizeRecallPrompt", () => {
  it("keeps a real prompt, trimmed", () => {
    expect(normalizeRecallPrompt("  What does SM-2 schedule?  ")).toBe("What does SM-2 schedule?");
  });

  it("treats absent input as no prompt", () => {
    expect(normalizeRecallPrompt(null)).toBeNull();
    expect(normalizeRecallPrompt(undefined)).toBeNull();
  });

  // The case this function exists for. A whitespace-only prompt is truthy
  // and non-null, so it would make a highlight look prompted to every check
  // in the app while asking the reader nothing -- the review card would
  // conceal the answer behind a blank question.
  it("treats an empty or whitespace-only prompt as no prompt", () => {
    expect(normalizeRecallPrompt("")).toBeNull();
    expect(normalizeRecallPrompt("   ")).toBeNull();
    expect(normalizeRecallPrompt("\n\t ")).toBeNull();
  });

  it("rejects non-strings rather than coercing them", () => {
    expect(normalizeRecallPrompt(42 as unknown as string)).toBeNull();
    expect(normalizeRecallPrompt({} as unknown as string)).toBeNull();
  });

  it("does not truncate a too-long prompt -- that's the validator's call", () => {
    const long = "q".repeat(MAX_RECALL_PROMPT_LENGTH + 50);
    expect(normalizeRecallPrompt(long)).toHaveLength(MAX_RECALL_PROMPT_LENGTH + 50);
  });
});

describe("isValidRecallPrompt", () => {
  it("accepts absent values -- no prompt is the normal case", () => {
    expect(isValidRecallPrompt(null)).toBe(true);
    expect(isValidRecallPrompt(undefined)).toBe(true);
  });

  it("accepts a prompt at the cap and rejects one past it", () => {
    expect(isValidRecallPrompt("q".repeat(MAX_RECALL_PROMPT_LENGTH))).toBe(true);
    expect(isValidRecallPrompt("q".repeat(MAX_RECALL_PROMPT_LENGTH + 1))).toBe(false);
  });

  // The cap is measured after trimming, matching what normalizeRecallPrompt
  // would actually store -- otherwise trailing whitespace could push an
  // acceptable prompt over the limit.
  it("measures the cap against the trimmed value", () => {
    expect(isValidRecallPrompt(`  ${"q".repeat(MAX_RECALL_PROMPT_LENGTH)}  `)).toBe(true);
  });

  it("rejects non-string values", () => {
    expect(isValidRecallPrompt(42)).toBe(false);
    expect(isValidRecallPrompt({ prompt: "hi" })).toBe(false);
    expect(isValidRecallPrompt(["hi"])).toBe(false);
  });
});
