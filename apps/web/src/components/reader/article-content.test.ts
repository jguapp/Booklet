import { describe, expect, it } from "vitest";
import { createOffsetPointFinder } from "@/lib/reader/dom-range";
import { nearestSectionEl, sectionAnchorNode } from "./article-content";

function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/**
 * The read-along section bar (the Readwise-style left edge marker on the
 * paragraph the TTS bot is currently on) resolves the chunk's start offset to
 * a DOM point, then reads that node's parentElement to decide which block to
 * mark.
 *
 * The bug: a chunk beginning exactly where a text node ends resolves to the
 * *earlier* node, and that node is routinely whitespace sitting directly
 * inside a wrapper -- an <article>, a Readability page <div> -- just before
 * its first real <p>, which is what indented source HTML produces. Its parent
 * is the wrapper, the wrapper contains every other paragraph too, so
 * nearestSectionEl's own "is this scoped to one section" guard correctly
 * refused it and nothing highlighted at all until playback reached a chunk
 * starting mid-paragraph -- a full chunk of audio later.
 *
 * This surfaced as an intermittent e2e failure (tts-player.spec.ts's
 * `.reading-section-active` assertion) that read like flakiness.
 */
describe("sectionAnchorNode", () => {
  it("advances past a boundary to the paragraph, not the whitespace before it", () => {
    const root = container("<article>\n  <p>First paragraph</p></article>");
    const point = createOffsetPointFinder(root)(3)!;
    // Precondition: the resolver hands back the whitespace node (see
    // dom-range.test.ts for why that is deliberate).
    expect(point.node.parentElement?.tagName).toBe("ARTICLE");

    const anchor = sectionAnchorNode(point, root);
    expect(anchor.parentElement?.tagName).toBe("P");
  });

  it("leaves a point in the middle of a node exactly where it is", () => {
    const root = container("<p>Hello there</p>");
    const point = createOffsetPointFinder(root)(3)!;
    expect(sectionAnchorNode(point, root)).toBe(point.node);
  });

  it("skips empty text nodes rather than anchoring to one", () => {
    const root = container("<article>\n  <p></p><p>Real text</p></article>");
    const point = createOffsetPointFinder(root)(3)!;
    const anchor = sectionAnchorNode(point, root);
    expect(anchor.textContent).toBe("Real text");
  });

  it("stays put at the very end of the container, with nothing to advance to", () => {
    const root = container("<p>abc</p>");
    const point = createOffsetPointFinder(root)(3)!;
    expect(sectionAnchorNode(point, root)).toBe(point.node);
  });
});

describe("nearestSectionEl", () => {
  it("picks the paragraph a point sits in", () => {
    const root = container("<p>one</p><p>two</p>");
    const node = root.querySelectorAll("p")[1].firstChild!;
    expect(nearestSectionEl(node, root)?.textContent).toBe("two");
  });

  it("refuses a wrapper that contains several real sections", () => {
    // This is the guard that made the bug above invisible rather than wrong:
    // <article> is a valid SECTION_SELECTOR match, but marking it would put
    // the indicator around the entire document.
    const root = container("<article>\n  <p>one</p><p>two</p></article>");
    const whitespace = root.querySelector("article")!.firstChild!;
    expect(nearestSectionEl(whitespace, root)).toBeNull();
  });

  it("falls back to a direct child of the container for loose text with no block wrapper", () => {
    // Real Readability output routinely has text sitting directly in a div
    // with no <p> around it -- closest() finds nothing useful, and returning
    // null there is what used to make the bar vanish mid-read.
    const root = container("<div>loose text with no paragraph</div>");
    const node = root.firstElementChild!.firstChild!;
    expect(nearestSectionEl(node, root)).toBe(root.firstElementChild);
  });

  it("returns null for the container itself", () => {
    const root = container("<p>one</p>");
    expect(nearestSectionEl(root, root)).toBeNull();
  });
});
