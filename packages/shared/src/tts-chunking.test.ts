import { describe, expect, it } from "vitest";
import { FIRST_CHUNK_MAX_CHARS, HARD_WRAP_MAX_CHARS, MAX_CHUNK_CHARS, toSafeTextChunks } from "./tts-chunking";

/**
 * The first chunk's size is time-to-first-audio: generation time scales with
 * chunk length, and nothing is playing yet to hide it behind. Two separate
 * bugs let chunk one reach up to four times its intended cap, and both
 * shipped -- so the invariant every case below asserts is the one that
 * actually matters.
 */
function words(n: number, word = "word"): string {
  return Array(n).fill(word).join(" ");
}

/** A single sentence of approximately `chars` characters, no internal
 * punctuation, ending in a period. */
function sentenceOf(chars: number): string {
  const body = words(Math.ceil(chars / 5)).slice(0, chars - 1);
  return `${body.trimEnd()}.`;
}

describe("toSafeTextChunks", () => {
  describe("the first-chunk cap, which is the whole point", () => {
    it("never exceeds the cap, whatever the input shape", () => {
      const cases: [string, string][] = [
        ["short sentences", "One. Two. Three. Four. Five. Six. Seven. Eight."],
        ["a single short sentence", "The dog barked."],
        ["an opener just over the cap", sentenceOf(FIRST_CHUNK_MAX_CHARS + 1)],
        ["an opener at the hard-wrap threshold", sentenceOf(HARD_WRAP_MAX_CHARS)],
        ["an opener past the hard-wrap threshold", sentenceOf(HARD_WRAP_MAX_CHARS + 200)],
        ["a clause-heavy opener", "The dog, a domesticated wolf, long a companion to humans, is found worldwide today."],
        ["no sentence punctuation at all", words(200)],
      ];
      for (const [label, text] of cases) {
        const chunks = toSafeTextChunks(text);
        expect(chunks.length, label).toBeGreaterThan(0);
        expect(chunks[0].length, `${label}: chunk 0 was ${chunks[0].length} chars`).toBeLessThanOrEqual(
          FIRST_CHUNK_MAX_CHARS,
        );
      }
    });

    // Regression guard, bug A: the hard-wrap loop used to measure against
    // HARD_WRAP_MAX_CHARS (320) instead of the current cap, so a long
    // opening sentence produced a ~320-char chunk one.
    it("splits a run-on opening sentence down to the first-chunk cap, not the hard-wrap width", () => {
      const runOn =
        "The dog is a domesticated descendant of the wolf, and is also called the domestic dog, and it was " +
        "the first species to be domesticated by humans, and it has been selectively bred over millennia " +
        "for various behaviours, sensory capabilities and physical attributes, and it is now found in a " +
        "very wide variety of breeds all across the entire world today.";
      expect(runOn.length).toBeGreaterThan(HARD_WRAP_MAX_CHARS);

      const chunks = toSafeTextChunks(runOn);
      expect(chunks[0].length).toBeLessThanOrEqual(FIRST_CHUNK_MAX_CHARS);
      // Prefers a clause boundary over an arbitrary word break, so the split
      // reads as an ordinary breath.
      expect(chunks[0]).toMatch(/[,;:—]$/);
    });

    // Regression guard, bug B: a single sentence between the cap and the
    // hard-wrap threshold used to be appended whole, because the accumulator
    // only flushed *before* appending and never split.
    it("splits a single opening sentence that sits between the cap and the hard-wrap threshold", () => {
      const opener =
        "The domestic dog is a domesticated descendant of the gray wolf and is characterised by an " +
        "upturned tail, which is found in a wide variety of breeds worldwide.";
      expect(opener.length).toBeGreaterThan(FIRST_CHUNK_MAX_CHARS);
      expect(opener.length).toBeLessThan(HARD_WRAP_MAX_CHARS);

      const chunks = toSafeTextChunks(opener);
      expect(chunks[0].length).toBeLessThanOrEqual(FIRST_CHUNK_MAX_CHARS);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe("later chunks keep the prosody guarantee", () => {
    // Deliberate, and the reason bug B was fixed for chunk zero only: two
    // independently-synthesized fragments of one sentence each get their own
    // prosody and edge silence, so a split mid-sentence is audible.
    it("keeps a sentence between the normal cap and the hard-wrap threshold whole after chunk one", () => {
      const opener = "Short opener here.";
      const long = sentenceOf(MAX_CHUNK_CHARS + 60);
      expect(long.length).toBeGreaterThan(MAX_CHUNK_CHARS);
      expect(long.length).toBeLessThan(HARD_WRAP_MAX_CHARS);

      const chunks = toSafeTextChunks(`${opener} ${long}`);
      // The long sentence survives intact as its own chunk rather than being
      // torn into fragments.
      expect(chunks.some((c) => c === long.trim())).toBe(true);
    });

    it("still splits a sentence past the hard-wrap threshold, even late in the text", () => {
      const runOn = `${words(120, "elephant")}.`;
      expect(runOn.length).toBeGreaterThan(HARD_WRAP_MAX_CHARS);
      const chunks = toSafeTextChunks(`Short opener. ${runOn}`);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(HARD_WRAP_MAX_CHARS);
      }
    });
  });

  describe("caption lines", () => {
    it("drops photo-credit style lines entirely rather than reading them aloud", () => {
      const chunks = toSafeTextChunks("Image credit: Getty Images. The dog barked loudly at the car.");
      expect(chunks.join(" ")).not.toContain("Getty");
      expect(chunks.join(" ")).toContain("The dog barked");
    });

    it("does not drop ordinary prose that merely starts with one of those words", () => {
      // Real regression: "Courtesy of decades of research..." and
      // "Illustration -- a favorite technique -- was used..." were being
      // swallowed whole, sometimes taking a whole paragraph of audio with them.
      const prose = "Courtesy of decades of research, the theory was eventually confirmed by observation.";
      expect(toSafeTextChunks(prose).join(" ")).toContain("decades of research");

      const dash = "Illustration — a favorite technique of the era — was used extensively in these books.";
      expect(toSafeTextChunks(dash).join(" ")).toContain("favorite technique");
    });
  });

  describe("infobox / fragment streams", () => {
    // The bug this guards: resetting the accumulator at every newline turned
    // a real Wikipedia article's taxonomy/citation fragments into 2283
    // chunks, most under 20 characters -- 2283 separate round trips for one
    // page. Accumulating across paragraph boundaries fixed it.
    it("groups newline-separated fragments instead of making each its own chunk", () => {
      const fragments = Array.from({ length: 300 }, (_, i) => `Fragment ${i}`).join("\n");
      const chunks = toSafeTextChunks(fragments);
      expect(chunks.length).toBeLessThan(60);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(HARD_WRAP_MAX_CHARS);
      }
    });
  });

  describe("normalization and edge cases", () => {
    it("collapses whitespace runs, which the read-along overlay depends on", () => {
      // article-content.tsx independently re-normalizes and does indexOf()
      // against this output; a chunk that kept a tab or double-space would
      // shift every offset after it.
      const chunks = toSafeTextChunks("The   dog\t\tbarked\n\n  loudly.");
      expect(chunks[0]).toBe("The dog barked loudly.");
    });

    it("returns nothing for empty or whitespace-only input", () => {
      expect(toSafeTextChunks("")).toEqual([]);
      expect(toSafeTextChunks("   \n\t ")).toEqual([]);
    });

    it("never emits an empty or untrimmed chunk", () => {
      const chunks = toSafeTextChunks(`  Leading space. ${words(200)}.  Trailing.  `);
      for (const chunk of chunks) {
        expect(chunk).toBe(chunk.trim());
        expect(chunk.length).toBeGreaterThan(0);
      }
    });

    it("preserves the full text, minus caption lines and whitespace collapsing", () => {
      const text = "First sentence here. Second sentence follows. Third one closes it out.";
      expect(toSafeTextChunks(text).join(" ")).toBe(text);
    });
  });

  describe("memoization", () => {
    it("returns the identical array for a repeated call, and recomputes for new text", () => {
      // prewarm and the play loop are handed the same string; without this
      // the whole article is re-chunked on the click path.
      const text = "One sentence. Two sentences. Three sentences here.";
      expect(toSafeTextChunks(text)).toBe(toSafeTextChunks(text));
      expect(toSafeTextChunks("Different text entirely.")).not.toBe(toSafeTextChunks(text));
    });
  });
});
