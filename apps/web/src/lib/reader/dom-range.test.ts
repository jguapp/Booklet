import { describe, expect, it } from "vitest";
import { createOffsetPointFinder, plainTextOf, rangeForTextOffsets, textOffsetsForRange } from "./dom-range";

function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("plainTextOf / textOffsetsForRange", () => {
  it("round-trips a range back to the offsets it was built from", () => {
    const root = container("<p>Hello there</p><p>Second paragraph</p>");
    const range = rangeForTextOffsets(root, 6, 11)!;
    expect(range.toString()).toBe("there");
    expect(textOffsetsForRange(root, range)).toEqual({ start: 6, end: 11 });
  });

  it("treats offsets as spanning the whole container, across elements", () => {
    const root = container("<p>abc</p><p>def</p>");
    expect(plainTextOf(root)).toBe("abcdef");
    expect(rangeForTextOffsets(root, 2, 4)!.toString()).toBe("cd");
  });
});

/**
 * At a text-node boundary this resolver returns the *end of the earlier
 * node*, not the start of the next. Those are the same document position for
 * a Range, and this behavior is deliberate: highlight rendering shares this
 * helper, and there the end point decides which text nodes get wrapped in
 * <mark>, so biasing it forward would change what gets wrapped.
 *
 * The read-along section bar needs the opposite bias, because it reads the
 * resolved node's parentElement -- so it corrects for this itself, in
 * article-content.tsx's sectionAnchorNode (tested there). Pinning the
 * asymmetry down in both places on purpose: "fixing" it here would look
 * obviously right and would silently change highlight wrapping.
 */
describe("offset resolution at a text-node boundary", () => {
  it("resolves to the end of the earlier node, which the section bar corrects for", () => {
    // The whitespace between <article> and <p> is its own text node, whose
    // parent is <article>. Offset 3 is the boundary between them.
    const root = container("<article>\n  <p>First paragraph</p></article>");
    const point = createOffsetPointFinder(root)(3)!;

    expect(point.node.data).toBe("\n  ");
    expect(point.offset).toBe(3);
    expect(point.node.parentElement?.tagName).toBe("ARTICLE");
  });

  it("still produces the right text for a range across that boundary", () => {
    const root = container("<article>\n  <p>First paragraph</p></article>");
    expect(rangeForTextOffsets(root, 3, 8)!.toString()).toBe("First");
  });

  it("still resolves an offset in the middle of a node to that node", () => {
    const root = container("<p>Hello there</p>");
    const pointFor = createOffsetPointFinder(root);
    const point = pointFor(3)!;
    expect(point.node.data).toBe("Hello there");
    expect(point.offset).toBe(3);
  });

  it("resolves the very last offset without running off the end", () => {
    const root = container("<p>abc</p>");
    const pointFor = createOffsetPointFinder(root);
    const point = pointFor(3)!;
    expect(point.node.data).toBe("abc");
    expect(point.offset).toBe(3);
  });

  it("preserves the same text for a range whichever side of the boundary it starts on", () => {
    const root = container("<div><span>one</span><span>two</span></div>");
    // Offset 3 is the boundary between the two spans.
    expect(rangeForTextOffsets(root, 3, 6)!.toString()).toBe("two");
    expect(rangeForTextOffsets(root, 0, 3)!.toString()).toBe("one");
    expect(rangeForTextOffsets(root, 1, 5)!.toString()).toBe("netw");
  });
});

describe("createOffsetPointFinder", () => {
  it("walks forward across many lookups without restarting", () => {
    const root = container("<p>aaaa</p><p>bbbb</p><p>cccc</p>");
    const pointFor = createOffsetPointFinder(root);
    expect(pointFor(1)!.node.data).toBe("aaaa");
    expect(pointFor(5)!.node.data).toBe("bbbb");
    expect(pointFor(9)!.node.data).toBe("cccc");
  });

  it("restarts correctly when asked for an earlier offset (overlapping highlights)", () => {
    const root = container("<p>aaaa</p><p>bbbb</p>");
    const pointFor = createOffsetPointFinder(root);
    expect(pointFor(6)!.node.data).toBe("bbbb");
    // Going backwards is legal -- two highlights can overlap.
    expect(pointFor(1)!.node.data).toBe("aaaa");
    expect(pointFor(1)!.offset).toBe(1);
  });

  it("returns null past the end of the container", () => {
    const root = container("<p>abc</p>");
    expect(createOffsetPointFinder(root)(99)).toBeNull();
  });
});
