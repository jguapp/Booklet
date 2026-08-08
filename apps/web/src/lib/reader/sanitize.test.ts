import { describe, expect, it } from "vitest";
import { SANITIZE_MUST_KEEP, XSS_PROBES } from "@booklet/shared";
import { sanitizeArticleHtml } from "./sanitize";

/**
 * The browser half of the stored-XSS fix, asserted against the *same*
 * probe list the api suite uses (XSS_PROBES in @booklet/shared).
 *
 * Sharing the list is the point. Two sanitizers with two test suites drift,
 * and the direction that matters is silent: a client that renders more than
 * the server checked is a hole, and nothing about it looks wrong. Adding a
 * probe to the shared list fails both suites until both are fixed.
 *
 * This runs in jsdom, so DOMPurify sees a real DOM and `window` exists --
 * which also means the `typeof window === "undefined"` branch in the module
 * under test is *not* exercised here. That branch is server-render only.
 */

describe("browser sanitizeArticleHtml removes every known vector", () => {
  for (const probe of XSS_PROBES) {
    it(`strips ${probe.name}`, () => {
      expect(sanitizeArticleHtml(probe.html).toLowerCase()).not.toContain(probe.mustNotContain.toLowerCase());
    });
  }
});

describe("browser sanitizeArticleHtml keeps what an article needs", () => {
  for (const keep of SANITIZE_MUST_KEEP) {
    it(`keeps ${keep.name}`, () => {
      expect(sanitizeArticleHtml(keep.html)).toContain(keep.mustContain);
    });
  }
});

describe("browser sanitizeArticleHtml edge cases", () => {
  it("returns an empty string for absent input, so callers need no null check", () => {
    expect(sanitizeArticleHtml(null)).toBe("");
    expect(sanitizeArticleHtml(undefined)).toBe("");
    expect(sanitizeArticleHtml("")).toBe("");
  });

  it("keeps inlined data: images, which is how a saved article survives a dead CDN", () => {
    // The single most likely thing to be broken by an over-eager allowlist:
    // extraction inlines images as data: URIs, so blocking that scheme would
    // silently strip the pictures out of every saved article.
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">';
    expect(sanitizeArticleHtml(html)).toContain("data:image/png;base64");
  });

  it("still strips a payload hidden behind a legitimate-looking data: image", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)">';
    const cleaned = sanitizeArticleHtml(html).toLowerCase();
    expect(cleaned).toContain("data:image/png;base64");
    expect(cleaned).not.toContain("onerror");
  });
});
