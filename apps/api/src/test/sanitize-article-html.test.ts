import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { SANITIZE_MUST_KEEP, XSS_PROBES } from "@booklet/shared";
import { sanitizeArticleHtml } from "../lib/sanitize.js";

/**
 * Stored XSS. Extracted article HTML was rendered with
 * dangerouslySetInnerHTML and nothing anywhere sanitized it, so saving a
 * link -- the one thing this product exists to do -- ran the sender's
 * JavaScript on the reader's origin, with the access token in localStorage.
 *
 * The first test is the important one and is deliberately not a unit test:
 * it drives the *real* Readability, because the reason this shipped is that
 * Readability looks like it sanitizes. It strips <script>, <iframe> and
 * javascript: hrefs, which is enough to make a careful person check once,
 * see those gone, and conclude wrongly.
 */

describe("what Readability actually leaves behind", () => {
  // Enough real prose that Readability treats the container as content
  // rather than discarding it as chrome.
  const filler =
    "<p>This paragraph exists so the extractor considers the page worth reading. " +
    "It needs a reasonable amount of prose before the scoring heuristic will treat " +
    "the container as real content rather than navigation boilerplate.</p>" +
    "<p>A second paragraph of ordinary text, for the same reason.</p>";

  function extract(payload: string): string {
    const dom = new JSDOM(
      `<!doctype html><html><head><title>Article</title></head><body><article><h1>Article</h1>${filler}<p>${payload}</p></article></body></html>`,
      { url: "https://example.com/article" },
    );
    return new Readability(dom.window.document).parse()?.content ?? "";
  }

  it("passes event-handler attributes straight through, which is why this module exists", () => {
    // If this ever starts failing, Readability has gained a sanitizer and
    // this comment needs revisiting -- but the sanitization stays either
    // way, because relying on an extractor for security is the mistake.
    const survived = extract('<img src="x" onerror="alert(1)">');
    expect(survived.toLowerCase()).toContain("onerror");
  });

  it("removes the same payload once sanitized", () => {
    const cleaned = sanitizeArticleHtml(extract('<img src="x" onerror="alert(1)">'))!;
    expect(cleaned.toLowerCase()).not.toContain("onerror");
    // And the image itself survives -- stripping the whole tag would be a
    // different bug.
    expect(cleaned.toLowerCase()).toContain("<img");
  });
});

describe("sanitizeArticleHtml removes every known vector", () => {
  for (const probe of XSS_PROBES) {
    it(`strips ${probe.name}`, () => {
      const cleaned = sanitizeArticleHtml(probe.html) ?? "";
      expect(cleaned.toLowerCase()).not.toContain(probe.mustNotContain.toLowerCase());
    });
  }
});

describe("sanitizeArticleHtml keeps what an article needs", () => {
  // Without these, "strip everything" would pass the suite above -- which is
  // a real risk, because a sanitizer that returns "" is trivially secure and
  // completely useless.
  for (const keep of SANITIZE_MUST_KEEP) {
    it(`keeps ${keep.name}`, () => {
      const cleaned = sanitizeArticleHtml(keep.html) ?? "";
      expect(cleaned).toContain(keep.mustContain);
    });
  }
});

describe("sanitizeArticleHtml edge cases", () => {
  it("returns null for absent input, so a failed extraction stores null", () => {
    expect(sanitizeArticleHtml(null)).toBeNull();
    expect(sanitizeArticleHtml(undefined)).toBeNull();
    expect(sanitizeArticleHtml("")).toBeNull();
  });

  it("is idempotent -- sanitizing stored-then-resanitized content is a no-op", () => {
    // The client sanitizes again at render, so every article goes through
    // this twice. The second pass must not degrade the first.
    const once = sanitizeArticleHtml('<p>text <a href="https://example.com">link</a></p>')!;
    expect(sanitizeArticleHtml(once)).toBe(once);
  });

  it("survives deeply nested and malformed markup without throwing", () => {
    expect(() => sanitizeArticleHtml("<div>".repeat(500) + "x" + "</div>".repeat(500))).not.toThrow();
    expect(() => sanitizeArticleHtml("<p><b>unclosed")).not.toThrow();
  });
});
