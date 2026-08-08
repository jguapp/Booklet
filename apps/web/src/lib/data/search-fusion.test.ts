import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@booklet/shared";

/**
 * The fusion half of local semantic search (#156) -- what happens to the two
 * ranked lists once they exist.
 *
 * Deliberately mocks the embedding side rather than running it. The model
 * itself is proved twice elsewhere, both times against the real thing: the
 * API's verify-embeddings script in Node, and e2e/semantic-search.spec.ts in a
 * real browser, which is the only place the Worker bundle can be exercised at
 * all. Repeating that here would buy a 25MB download and a dependency on
 * huggingface.co being reachable in exchange for testing someone else's
 * matrix multiply.
 *
 * What is worth asserting is the wiring, because every one of these is a way
 * the feature can silently do the wrong thing while every other test passes:
 * that the disabled path is byte-for-byte the old keyword search, that a
 * semantic-only match can actually reach the results, that failure degrades
 * instead of throwing, and that trashed articles cannot ride in on the
 * semantic list -- which they otherwise would, since embeddings are
 * deliberately kept when an article is trashed.
 */

const mocks = vi.hoisted(() => ({
  enabled: false,
  semanticIds: [] as string[],
  hasEmbeddings: true,
  semanticThrows: false,
  articles: [] as Article[],
}));

vi.mock("@/lib/search/local-embeddings", () => ({
  loadSemanticSearchEnabled: () => mocks.enabled,
  hasLocalEmbeddings: async () => mocks.hasEmbeddings,
  semanticSearchLocal: async () => {
    if (mocks.semanticThrows) throw new Error("model unavailable");
    return mocks.semanticIds;
  },
}));

vi.mock("@/lib/local/db", () => ({
  localArticles: { getAll: async () => mocks.articles },
  localHighlights: { getAll: async () => [] },
}));

const { searchLibrary } = await import("./search");

function article(over: Partial<Article> & { id: string }): Article {
  return {
    userId: "u1",
    url: null,
    canonicalUrl: null,
    title: null,
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText: null,
    textSource: null,
    fileStorageKey: null,
    originalFilename: null,
    savedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    readingProgress: 0,
    status: "UNREAD",
    tags: [],
    favorited: false,
    activeReadingSeconds: 0,
    listeningFraction: null,
    listeningUpdatedAt: null,
    listeningDeviceId: null,
    ...over,
  } as Article;
}

describe("local search fusion", () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.semanticIds = [];
    mocks.hasEmbeddings = true;
    mocks.semanticThrows = false;
    mocks.articles = [
      article({ id: "keyword-hit", title: "Deadlines and creativity", extractedText: "deadlines everywhere" }),
      // The case the whole feature exists for: no query word appears in it.
      article({ id: "meaning-hit", title: "Working under constraint", extractedText: "time pressure sharpens work" }),
      article({ id: "unrelated", title: "Pasta", extractedText: "boil the water" }),
    ];
  });

  it("is plain keyword search while the setting is off", async () => {
    mocks.semanticIds = ["meaning-hit"];
    const result = await searchLibrary("deadlines", false);
    expect(result.articles.map((a) => a.id)).toEqual(["keyword-hit"]);
  });

  it("surfaces an article that shares no word with the query once enabled", async () => {
    mocks.enabled = true;
    mocks.semanticIds = ["meaning-hit"];

    const result = await searchLibrary("deadlines", false);
    const ids = result.articles.map((a) => a.id);
    expect(ids).toContain("meaning-hit");
    // Still present, and still ahead of it -- an exact keyword match must not
    // be displaced by a merely-related one.
    expect(ids[0]).toBe("keyword-hit");
  });

  it("keeps the keyword ranking when nothing has been indexed yet", async () => {
    mocks.enabled = true;
    mocks.hasEmbeddings = false;
    mocks.semanticIds = ["meaning-hit"];

    const result = await searchLibrary("deadlines", false);
    expect(result.articles.map((a) => a.id)).toEqual(["keyword-hit"]);
  });

  it("degrades to keyword-only rather than throwing when the model fails", async () => {
    mocks.enabled = true;
    mocks.semanticThrows = true;

    const result = await searchLibrary("deadlines", false);
    expect(result.articles.map((a) => a.id)).toEqual(["keyword-hit"]);
  });

  it("does not let a trashed article in through the semantic list", async () => {
    mocks.enabled = true;
    mocks.articles = [
      ...mocks.articles,
      article({ id: "trashed", title: "Constraint", deletedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    // Embeddings outlive trashing on purpose, so restoring doesn't re-index --
    // which means the semantic side really can return one of these.
    mocks.semanticIds = ["trashed", "meaning-hit"];

    const result = await searchLibrary("deadlines", false);
    expect(result.articles.map((a) => a.id)).not.toContain("trashed");
  });

  it("returns nothing for an empty query without consulting either index", async () => {
    mocks.enabled = true;
    mocks.semanticIds = ["meaning-hit"];
    const result = await searchLibrary("   ", false);
    expect(result.articles).toEqual([]);
  });
});
