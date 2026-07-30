import { describe, expect, it } from "vitest";
import { parseKindleClippings } from "./kindle-clippings";

const SAMPLE = `Thinking, Fast and Slow (Daniel Kahneman)
- Your Highlight on page 12 | Location 234-236 | Added on Sunday, January 1, 2023 11:30:00 PM

Nothing in life is as important as you think it is while you are thinking about it.
==========
Thinking, Fast and Slow (Daniel Kahneman)
- Your Note on page 15 | Location 300 | Added on Sunday, January 1, 2023 11:35:00 PM

This connects to the anchoring chapter later on.
==========
Thinking, Fast and Slow (Daniel Kahneman)
- Your Bookmark on page 20 | Location 400 | Added on Sunday, January 1, 2023 11:40:00 PM

==========
Sapiens (Yuval Noah Harari)
- Your Highlight on page 5 | Location 50-52 | Added on Monday, January 2, 2023 9:00:00 AM

History is something very few people have been doing while everyone else was ploughing fields.
==========
`;

describe("parseKindleClippings", () => {
  it("groups clippings by book", () => {
    const books = parseKindleClippings(SAMPLE);
    expect(books).toHaveLength(2);
    expect(books.map((b) => b.title)).toEqual(["Thinking, Fast and Slow", "Sapiens"]);
  });

  it("extracts the author from the parenthesized part of the title line", () => {
    const books = parseKindleClippings(SAMPLE);
    expect(books[0].author).toBe("Daniel Kahneman");
    expect(books[1].author).toBe("Yuval Noah Harari");
  });

  it("captures highlight and note text correctly", () => {
    const [book] = parseKindleClippings(SAMPLE);
    const highlight = book.entries.find((e) => e.type === "highlight");
    const note = book.entries.find((e) => e.type === "note");
    expect(highlight?.text).toContain("Nothing in life is as important");
    expect(note?.text).toContain("anchoring chapter");
  });

  it("drops bookmarks -- no text content to import", () => {
    const [book] = parseKindleClippings(SAMPLE);
    expect(book.entries.some((e) => e.type === "bookmark")).toBe(false);
    expect(book.entries).toHaveLength(2); // just the highlight + note, not the bookmark
  });

  it("handles a leading BOM on the very first entry without corrupting the title", () => {
    const withBom = "﻿" + SAMPLE;
    const books = parseKindleClippings(withBom);
    expect(books[0].title).toBe("Thinking, Fast and Slow");
  });

  it("returns an empty array for empty or unparseable input", () => {
    expect(parseKindleClippings("")).toEqual([]);
    expect(parseKindleClippings("not a clippings file at all")).toEqual([]);
  });

  it("handles a title with parentheses in it, not just around the author", () => {
    const text = `Foundation (Book One) (Isaac Asimov)\n- Your Highlight on page 1 | Location 1 | Added on today\n\nSome quote.\n==========\n`;
    const [book] = parseKindleClippings(text);
    expect(book.title).toBe("Foundation (Book One)");
    expect(book.author).toBe("Isaac Asimov");
  });
});
