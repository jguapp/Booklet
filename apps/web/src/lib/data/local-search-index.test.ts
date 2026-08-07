import { beforeEach, describe, expect, it } from "vitest";
import type { Article } from "@booklet/shared";
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from "@booklet/shared";
import { buildSnippet, getArticleIndex, matchesAllTerms, resetArticleIndexCache } from "./local-search-index";

/**
 * The local half of #155, asserted against the same behaviours as the
 * server-side tests (apps/api/src/test/search-ranking.test.ts) -- multi-word
 * AND, ranking, stemming, snippets. Exact score parity between MiniSearch and
 * ts_rank is explicitly not expected; these check the ordering and matching a
 * reader would notice, which is what "comparable quality" means.
 */

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
    coverImageUrl: null,
    readingTimeEstimate: null,
    skippedImageCount: 0,
    progressFraction: 0,
    activeReadingSeconds: 0,
    tags: [],
    status: "UNREAD",
    savedAt: "2024-01-01T00:00:00.000Z",
    readAt: null,
    archivedAt: null,
    favorited: false,
    deletedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

const titleHit = article({
  id: "title-hit",
  title: "Deep work and flow state",
  excerpt: "On sustained attention",
  extractedText: "Runners run every morning to build the habit.",
});

const bodyHit = article({
  id: "body-hit",
  title: "Gardening basics",
  excerpt: "Soil and seeds",
  extractedText:
    "A long digression about compost. Much later the text mentions flow and, separately, a state of attention worth noting.",
});

const miss = article({ id: "miss", title: "Cooking pasta", extractedText: "Boil water, add salt." });

const corpus = [titleHit, bodyHit, miss];

describe("local search index", () => {
  beforeEach(() => resetArticleIndexCache());

  it("matches multi-word queries whose terms are not adjacent", () => {
    const ids = getArticleIndex(corpus)
      .search("flow state attention")
      .map((r) => r.id);
    expect(ids).toContain("title-hit");
    expect(ids).toContain("body-hit");
    expect(ids).not.toContain("miss");
  });

  it("ranks a title match above a body mention", () => {
    const ids = getArticleIndex(corpus)
      .search("flow state attention")
      .map((r) => r.id);
    expect(ids[0]).toBe("title-hit");
  });

  it("stems, so a query finds a different inflection", () => {
    const ids = getArticleIndex(corpus)
      .search("running")
      .map((r) => r.id);
    expect(ids).toContain("title-hit");
  });

  it("matches tags", () => {
    const tagged = [article({ id: "tagged", title: "Something", tags: ["kitchen"] })];
    const ids = getArticleIndex(tagged)
      .search("kitchen")
      .map((r) => r.id);
    expect(ids).toContain("tagged");
  });

  it("reuses the index when the library has not changed, and rebuilds when it has", () => {
    const first = getArticleIndex(corpus);
    expect(getArticleIndex(corpus)).toBe(first); // same signature -> not rebuilt per keystroke

    const changed = [...corpus, article({ id: "new", title: "Added later", updatedAt: "2025-06-01T00:00:00.000Z" })];
    expect(getArticleIndex(changed)).not.toBe(first);
  });

  it("rebuilds when an existing article is edited, not only when one is added", () => {
    const first = getArticleIndex(corpus);
    const edited = corpus.map((a) => (a.id === "miss" ? { ...a, updatedAt: "2026-01-01T00:00:00.000Z" } : a));
    expect(getArticleIndex(edited)).not.toBe(first);
  });
});

describe("buildSnippet", () => {
  it("returns context around the match with the term marked", () => {
    const snippet = buildSnippet(bodyHit.extractedText!, ["compost"]);
    expect(snippet).toContain(`${SNIPPET_MARK_START}compost.${SNIPPET_MARK_END}`);
    expect(snippet!.length).toBeLessThan(400);
  });

  it("marks every matching word in the window, not just the first", () => {
    const snippet = buildSnippet("alpha bravo charlie alpha", ["alpha"])!;
    const marks = snippet.split(SNIPPET_MARK_START).length - 1;
    expect(marks).toBe(2);
  });

  it("marks a stemmed match, matching how the index found it", () => {
    const snippet = buildSnippet("Runners run every morning.", ["running"]);
    expect(snippet).toContain(SNIPPET_MARK_START);
  });

  it("emits no HTML, so the UI never needs dangerouslySetInnerHTML", () => {
    const snippet = buildSnippet("a <script>alert(1)</script> compost pile", ["compost"])!;
    expect(snippet).not.toContain("<mark>");
    // The raw text is passed through verbatim -- which is exactly why it must
    // never be interpolated into HTML downstream.
    expect(snippet).toContain("<script>");
  });

  it("returns null when nothing matched, rather than a misleading opening excerpt", () => {
    expect(buildSnippet("nothing relevant here", ["compost"])).toBeNull();
    expect(buildSnippet("", ["compost"])).toBeNull();
  });
});

describe("matchesAllTerms", () => {
  it("requires every term, across the combined fields", () => {
    expect(matchesAllTerms(["flow state", "on attention"], ["flow", "attention"])).toBe(true);
    expect(matchesAllTerms(["flow state"], ["flow", "attention"])).toBe(false);
  });

  it("ignores null and undefined fields", () => {
    expect(matchesAllTerms([null, undefined, "flow"], ["flow"])).toBe(true);
  });
});
