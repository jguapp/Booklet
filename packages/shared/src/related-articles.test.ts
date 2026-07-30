import { describe, expect, it } from "vitest";
import { computeRelatedArticles, type RelatedArticleCandidate } from "./related-articles";

function article(overrides: Partial<RelatedArticleCandidate> & { id: string }): RelatedArticleCandidate {
  return { title: null, siteName: null, author: null, tags: [], ...overrides };
}

describe("computeRelatedArticles", () => {
  it("ranks shared-tag articles above unrelated ones", () => {
    const target = article({ id: "1", tags: ["productivity", "focus"] });
    const related = article({ id: "2", tags: ["productivity", "focus"] });
    const unrelated = article({ id: "3", tags: ["cooking"] });

    const result = computeRelatedArticles(target, [unrelated, related]);
    expect(result.map((a) => a.id)).toEqual(["2"]);
  });

  it("never includes the target article itself", () => {
    const target = article({ id: "1", tags: ["a"] });
    const result = computeRelatedArticles(target, [target]);
    expect(result).toHaveLength(0);
  });

  it("scores same-site articles even with no shared tags", () => {
    const target = article({ id: "1", siteName: "nytimes.com" });
    const sameSite = article({ id: "2", siteName: "nytimes.com" });
    const otherSite = article({ id: "3", siteName: "example.com" });

    const result = computeRelatedArticles(target, [otherSite, sameSite]);
    expect(result[0].id).toBe("2");
  });

  it("scores overlapping title keywords", () => {
    const target = article({ id: "1", title: "The Future of Machine Learning" });
    const related = article({ id: "2", title: "Machine Learning in Practice" });
    const unrelated = article({ id: "3", title: "A History of Jazz" });

    const result = computeRelatedArticles(target, [unrelated, related]);
    expect(result.map((a) => a.id)).toEqual(["2"]);
  });

  it("returns nothing when there's no meaningful overlap at all", () => {
    const target = article({ id: "1", title: "Foo", tags: ["x"] });
    const result = computeRelatedArticles(target, [article({ id: "2", title: "Bar", tags: ["y"] })]);
    expect(result).toHaveLength(0);
  });

  it("respects the limit", () => {
    const target = article({ id: "1", tags: ["shared"] });
    const candidates = Array.from({ length: 10 }, (_, i) => article({ id: `c${i}`, tags: ["shared"] }));
    const result = computeRelatedArticles(target, candidates, 3);
    expect(result).toHaveLength(3);
  });
});
