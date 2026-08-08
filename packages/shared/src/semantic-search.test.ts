import { describe, expect, it } from "vitest";
import { chunkForEmbedding, cosineSimilarity, rankBySimilarity, reciprocalRankFusion } from "./semantic-search";

describe("cosineSimilarity", () => {
  it("is 1 for identical direction and -1 for opposite", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("ignores magnitude, which is the whole point of using cosine", () => {
    // Same direction, very different lengths -- a dot product would rank the
    // longer vector higher purely for being longer.
    expect(cosineSimilarity([1, 1], [50, 50])).toBeCloseTo(1);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    // NaN would not merely be wrong, it would sort unpredictably and silently
    // corrupt the ordering of everything around it.
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("throws on a dimension mismatch instead of silently comparing prefixes", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });

  it("accepts a Float32Array, which is what a real embedding arrives as", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
  });
});

describe("chunkForEmbedding", () => {
  it("returns a single chunk for text that already fits", () => {
    expect(chunkForEmbedding("short text", 100)).toEqual(["short text"]);
  });

  it("splits long text into overlapping windows", () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkForEmbedding(text, 300, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
  });

  it("never ends a window mid-word", () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    for (const c of chunkForEmbedding(text, 120, 20)) {
      expect(c.startsWith(" ")).toBe(false);
      expect(c.endsWith(" ")).toBe(false);
    }
  });

  it("overlaps windows, so a passage on a boundary is whole in one of them", () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkForEmbedding(text, 100, 40);
    // The tail of one window reappears at the head of the next.
    const firstTailWord = chunks[0].split(" ").at(-1)!;
    expect(chunks[1]).toContain(firstTailWord);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkForEmbedding("")).toEqual([]);
    expect(chunkForEmbedding("   \n\t ")).toEqual([]);
  });

  it("terminates on text with no spaces at all", () => {
    // A pathological input that a lastIndexOf-based backoff can loop on
    // forever if it never finds a space.
    const chunks = chunkForEmbedding("x".repeat(1000), 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeGreaterThan(900);
  });
});

describe("reciprocalRankFusion", () => {
  it("ranks a document both lists agree on above one either list alone tops", () => {
    const keyword = ["agreed", "keywordOnly"];
    const vector = ["agreed", "vectorOnly"];
    const [first] = reciprocalRankFusion([keyword, vector]);
    expect(first.id).toBe("agreed");
  });

  it("keeps a keyword-only top hit first when the vector list does not disagree", () => {
    // The acceptance criterion: hybrid must not be worse than keyword alone
    // for exact-term queries.
    const keyword = ["exactMatch", "other"];
    const vector = ["unrelatedA", "unrelatedB"];
    expect(reciprocalRankFusion([keyword, vector])[0].id).toBe("exactMatch");
  });

  it("includes documents found by only one search", () => {
    const ids = reciprocalRankFusion([["a"], ["b"]]).map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("is order-stable for ties, so repeated runs agree", () => {
    const once = reciprocalRankFusion([["x", "y"], ["y", "x"]]).map((r) => r.id);
    const twice = reciprocalRankFusion([["y", "x"], ["x", "y"]]).map((r) => r.id);
    expect(once).toEqual(twice);
  });

  it("handles empty lists without producing entries", () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

describe("rankBySimilarity", () => {
  const query = [1, 0];

  it("scores an article by its best chunk, not an average", () => {
    // One strong chunk and one irrelevant one. Averaging would rank this
    // below a mediocre-but-uniform article; it should not.
    const results = rankBySimilarity(query, [
      { id: "strongest-chunk", vector: [1, 0] },
      { id: "strongest-chunk", vector: [0, 1] },
      { id: "uniformly-mediocre", vector: [0.7, 0.7] },
    ]);
    expect(results[0].id).toBe("strongest-chunk");
    expect(results[0].score).toBeCloseTo(1);
  });

  it("drops candidates below the floor rather than returning everything ranked", () => {
    const results = rankBySimilarity(query, [{ id: "orthogonal", vector: [0, 1] }], 0.2);
    expect(results).toEqual([]);
  });

  it("returns best first", () => {
    const ids = rankBySimilarity(query, [
      { id: "far", vector: [0.3, 0.95] },
      { id: "near", vector: [0.98, 0.2] },
    ]).map((r) => r.id);
    expect(ids[0]).toBe("near");
  });
});
