import { describe, expect, it } from "vitest";
import {
  characterProportionalTimings,
  compareTimings,
  countSyllables,
  syllablePauseTimings,
  wordSpansOf,
} from "./readalong-timing";

/**
 * These pin the two timing models used to decide #159. They matter because
 * the whole argument for (or against) forced alignment rests on the numbers
 * these produce -- a quietly wrong model would send that decision the wrong
 * way, and unlike a rendering bug there is nothing on screen to notice.
 */

describe("wordSpansOf", () => {
  it("indexes into the original string, gaps included", () => {
    const spans = wordSpansOf("one  two");
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [5, 8],
    ]);
  });

  it("keeps punctuation attached to its word", () => {
    // The syllable model charges a pause after the word carrying the mark,
    // so splitting punctuation off would silently remove every pause.
    expect(wordSpansOf("Wait, no.").map((s) => s.text)).toEqual(["Wait,", "no."]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(wordSpansOf("")).toEqual([]);
    expect(wordSpansOf("   \n ")).toEqual([]);
  });
});

describe("countSyllables", () => {
  it("counts vowel groups", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("water")).toBe(2);
    expect(countSyllables("photosynthesis")).toBe(5);
  });

  it("drops a silent terminal e", () => {
    expect(countSyllables("time")).toBe(1);
    expect(countSyllables("make")).toBe(1);
  });

  it("keeps the e when it is the only vowel group", () => {
    // Without the n > 1 guard this returns 0 and the word takes no time.
    expect(countSyllables("the")).toBe(1);
    expect(countSyllables("he")).toBe(1);
  });

  it("never returns zero for a word with letters", () => {
    expect(countSyllables("rhythm")).toBeGreaterThanOrEqual(1);
    expect(countSyllables("shh")).toBeGreaterThanOrEqual(1);
  });

  it("returns zero only for input with no letters at all", () => {
    expect(countSyllables("—")).toBe(0);
    expect(countSyllables("123")).toBe(0);
  });
});

describe("characterProportionalTimings", () => {
  it("maps character offset to time linearly", () => {
    // "ab cd" -- second word starts at char 3 of 5, so 60% through.
    const t = characterProportionalTimings("ab cd", 10);
    expect(t[0]).toBeCloseTo(0);
    expect(t[1]).toBeCloseTo(6);
  });

  it("starts the first word at zero", () => {
    expect(characterProportionalTimings("hello world", 4)[0]).toBe(0);
  });

  it("survives empty input", () => {
    expect(characterProportionalTimings("", 5)).toEqual([]);
  });
});

describe("syllablePauseTimings", () => {
  const params = { secondsPerSyllable: 0.2, commaPauseSeconds: 0.15, sentencePauseSeconds: 0.4 };

  it("gives a polysyllabic word more of the chunk than a short one", () => {
    // Character-proportional would treat "photosynthesis happens" as roughly
    // 15:8 by characters; by syllables it is 5:2. The models disagreeing
    // here is the entire premise of the analysis.
    const text = "photosynthesis happens";
    const syl = syllablePauseTimings(text, 10, params);
    const chr = characterProportionalTimings(text, 10);
    expect(syl[1]).toBeGreaterThan(chr[1]!);
  });

  it("charges a sentence pause to the word carrying the mark", () => {
    const withPause = syllablePauseTimings("go. now", 10, params);
    const without = syllablePauseTimings("go now", 10, params);
    // Both are rescaled to the same duration, so the pause shows up as the
    // second word starting proportionally later.
    expect(withPause[1]).toBeGreaterThan(without[1]!);
  });

  it("weights a sentence pause more heavily than a comma", () => {
    const sentence = syllablePauseTimings("go. now", 10, params);
    const comma = syllablePauseTimings("go, now", 10, params);
    expect(sentence[1]).toBeGreaterThan(comma[1]!);
  });

  it("always finishes within the given duration", () => {
    const t = syllablePauseTimings("The quick brown fox jumps over the lazy dog.", 7, params);
    for (const s of t) expect(s).toBeLessThanOrEqual(7);
  });

  it("depends only on the ratio of pause time to syllable time", () => {
    // Scaling all three together is absorbed by the rescale, so it must be a
    // no-op. This is what makes the sweep in analyze-readalong-drift.ts
    // legitimate: it varies the pauses against a fixed syllable duration,
    // which looks like holding a parameter constant but is really sweeping
    // the only axis that exists.
    const a = syllablePauseTimings("one two. three", 10, params);
    const b = syllablePauseTimings("one two. three", 10, {
      secondsPerSyllable: params.secondsPerSyllable * 3,
      commaPauseSeconds: params.commaPauseSeconds * 3,
      sentencePauseSeconds: params.sentencePauseSeconds * 3,
    });
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 6);
  });

  it("does move when a pause changes relative to syllable duration", () => {
    // The converse of the above, and the reason the sweep is not vacuous.
    const a = syllablePauseTimings("one two. three", 10, { ...params, sentencePauseSeconds: 0.1 });
    const b = syllablePauseTimings("one two. three", 10, { ...params, sentencePauseSeconds: 0.9 });
    expect(a[2]).not.toBeCloseTo(b[2]!, 3);
  });

  it("survives empty input", () => {
    expect(syllablePauseTimings("", 5, params)).toEqual([]);
  });
});

describe("compareTimings", () => {
  it("reports max, rms and signed mean in milliseconds", () => {
    const c = compareTimings([0, 1, 2], [0, 1.1, 1.8]);
    expect(c.wordCount).toBe(3);
    expect(c.maxAbsMs).toBeCloseTo(200, 6);
    expect(c.meanSignedMs).toBeCloseTo((0 - 100 + 200) / 3, 6);
  });

  it("is zero for identical inputs", () => {
    const c = compareTimings([0, 1, 2], [0, 1, 2]);
    expect(c.maxAbsMs).toBe(0);
    expect(c.rmsMs).toBe(0);
  });

  it("compares only the overlap when lengths differ", () => {
    expect(compareTimings([0, 1], [0, 1, 2]).wordCount).toBe(2);
  });

  it("survives empty input", () => {
    expect(compareTimings([], [])).toEqual({ wordCount: 0, maxAbsMs: 0, rmsMs: 0, meanSignedMs: 0 });
  });
});
