import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "./url-canonicalize";

describe("canonicalizeUrl", () => {
  it("strips tracking params", () => {
    expect(canonicalizeUrl("https://example.com/article?utm_source=twitter&utm_medium=social")).toBe(
      "https://example.com/article",
    );
    expect(canonicalizeUrl("https://example.com/article?fbclid=abc123")).toBe("https://example.com/article");
  });

  it("keeps real, content-relevant query params", () => {
    expect(canonicalizeUrl("https://example.com/search?q=readability&utm_source=x")).toBe(
      "https://example.com/search?q=readability",
    );
  });

  it("normalizes host casing and strips a leading www.", () => {
    expect(canonicalizeUrl("https://WWW.Example.com/article")).toBe("https://example.com/article");
  });

  it("normalizes a trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/article/")).toBe(canonicalizeUrl("https://example.com/article"));
  });

  it("treats the root path with or without a trailing slash the same", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe(canonicalizeUrl("https://example.com"));
  });

  it("drops the fragment", () => {
    expect(canonicalizeUrl("https://example.com/article#section-2")).toBe("https://example.com/article");
  });

  it("query params are order-independent", () => {
    expect(canonicalizeUrl("https://example.com/a?b=1&a=2")).toBe(canonicalizeUrl("https://example.com/a?a=2&b=1"));
  });

  it("drops a default port but keeps a non-default one", () => {
    expect(canonicalizeUrl("https://example.com:443/article")).toBe("https://example.com/article");
    expect(canonicalizeUrl("https://example.com:8443/article")).toBe("https://example.com:8443/article");
  });

  it("genuinely different articles stay distinct", () => {
    expect(canonicalizeUrl("https://example.com/article-one")).not.toBe(
      canonicalizeUrl("https://example.com/article-two"),
    );
  });

  it("returns null for an unparseable URL instead of throwing", () => {
    expect(canonicalizeUrl("not a url")).toBeNull();
  });

  // searchParams.entries() decodes, so re-joining the raw values with "=" and
  // "&" let a value's own separators turn into structural ones. Both of these
  // used to produce "a=1&b=2", which means the second URL saved is thrown away
  // as a duplicate of the first.
  it("a separator inside a value doesn't merge two different URLs", () => {
    expect(canonicalizeUrl("https://example.com/x?a=1%26b=2")).not.toBe(
      canonicalizeUrl("https://example.com/x?a=1&b=2"),
    );
  });

  it("keeps the query string a legal URL", () => {
    // Came back out as a raw space before, which no URL may contain.
    expect(canonicalizeUrl("https://example.com/s?q=hello%20world")).toBe("https://example.com/s?q=hello%20world");
  });

  it("still ignores encoding differences that mean the same thing", () => {
    // "+" and "%20" are both a space in a query string, so these are one page.
    expect(canonicalizeUrl("https://example.com/s?q=a+b")).toBe(canonicalizeUrl("https://example.com/s?q=a%20b"));
  });
});
