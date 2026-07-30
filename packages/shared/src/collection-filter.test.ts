import { describe, expect, it } from "vitest";
import { matchesCollectionFilter, type FilterableArticle } from "./collection-filter";

function article(overrides: Partial<FilterableArticle> = {}): FilterableArticle {
  return {
    status: "UNREAD",
    favorited: false,
    tags: [],
    title: null,
    excerpt: null,
    extractedText: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("matchesCollectionFilter", () => {
  it("matches everything against an empty filter (excluding trash)", () => {
    expect(matchesCollectionFilter(article(), {})).toBe(true);
    expect(matchesCollectionFilter(article({ deletedAt: "2026-01-01T00:00:00Z" }), {})).toBe(false);
  });

  it("filters by status", () => {
    expect(matchesCollectionFilter(article({ status: "UNREAD" }), { status: "UNREAD" })).toBe(true);
    expect(matchesCollectionFilter(article({ status: "READING" }), { status: "UNREAD" })).toBe(false);
  });

  it("filters by favorited", () => {
    expect(matchesCollectionFilter(article({ favorited: true }), { favorited: true })).toBe(true);
    expect(matchesCollectionFilter(article({ favorited: false }), { favorited: true })).toBe(false);
  });

  it("requires every listed tag to be present (AND, not OR)", () => {
    const a = article({ tags: ["a", "b"] });
    expect(matchesCollectionFilter(a, { tags: ["a"] })).toBe(true);
    expect(matchesCollectionFilter(a, { tags: ["a", "b"] })).toBe(true);
    expect(matchesCollectionFilter(a, { tags: ["a", "c"] })).toBe(false);
  });

  it("matches a text query against title, excerpt, or body", () => {
    expect(matchesCollectionFilter(article({ title: "Readability matters" }), { textQuery: "readability" })).toBe(
      true,
    );
    expect(matchesCollectionFilter(article({ extractedText: "deep in the body" }), { textQuery: "deep" })).toBe(
      true,
    );
    expect(matchesCollectionFilter(article({ title: "Unrelated" }), { textQuery: "readability" })).toBe(false);
  });

  it("combines multiple conditions with AND", () => {
    const a = article({ status: "UNREAD", tags: ["later"] });
    expect(matchesCollectionFilter(a, { status: "UNREAD", tags: ["later"] })).toBe(true);
    expect(matchesCollectionFilter(a, { status: "ARCHIVED", tags: ["later"] })).toBe(false);
  });
});
