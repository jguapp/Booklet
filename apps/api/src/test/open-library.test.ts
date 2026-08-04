import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractIsbn,
  isWeakBookTitle,
  lookupBookMetadata,
  titleQueryFromFilename,
} from "../services/open-library.js";

// A real, valid JPEG large enough to clear the placeholder-size floor -- Open
// Library answers "no cover" with a tiny placeholder rather than a 404, so byte
// length is load-bearing here, not incidental.
const COVER_BYTES = Buffer.concat([
  Buffer.from("ffd8ffe000104a464946000101", "hex"),
  Buffer.alloc(1024, 0x42),
]);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function imageResponse(bytes: Buffer = COVER_BYTES): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWeakBookTitle", () => {
  it("accepts real titles", () => {
    for (const title of [
      "Pride and Prejudice",
      "Catch-22",
      "1984",
      "The Left Hand of Darkness",
      "Slaughterhouse-Five",
      "Gödel, Escher, Bach: An Eternal Golden Braid",
    ]) {
      expect(isWeakBookTitle(title, "some-upload"), title).toBe(false);
    }
  });

  it("rejects the shapes uploads actually arrive with", () => {
    for (const title of [
      null,
      undefined,
      "",
      "   ",
      "untitled",
      "Untitled Document",
      "Microsoft Word - draft3.doc",
      "pride_and_prejudice",
      "the-hobbit",
      "My Book FINAL",
      "Report v2",
      "Thesis (draft)".replace("(draft)", "draft"),
      "9780141439518",
      "scan0001",
      "book.pdf",
    ]) {
      expect(isWeakBookTitle(title, "some-upload"), String(title)).toBe(true);
    }
  });

  it("treats a title that is just the filename as no information at all", () => {
    expect(isWeakBookTitle("Pride and Prejudice", "Pride and Prejudice")).toBe(true);
    expect(isWeakBookTitle("pride and prejudice", "Pride And Prejudice")).toBe(true);
  });
});

describe("titleQueryFromFilename", () => {
  it("recovers a searchable title from real-world filenames", () => {
    expect(titleQueryFromFilename("9780141439518_pride_and_prejudice_FINAL_v2.epub")).toBe("pride and prejudice");
    expect(titleQueryFromFilename("the-left-hand-of-darkness.pdf")).toBe("the left hand of darkness");
    expect(titleQueryFromFilename("Dune (z-lib.org).epub")).toBe("Dune");
    expect(titleQueryFromFilename("Neuromancer [retail].epub")).toBe("Neuromancer");
  });

  it("keeps hyphens that are part of the title", () => {
    expect(titleQueryFromFilename("Catch-22.epub")).toBe("Catch-22");
  });
});

describe("extractIsbn", () => {
  it("prefers a labelled ISBN and normalises separators", () => {
    expect(extractIsbn(["ISBN: 978-0-14-143951-8"])).toBe("9780141439518");
    expect(extractIsbn(["ISBN-13: 9780141439518"])).toBe("9780141439518");
  });

  it("finds a bare ISBN-13 in a filename", () => {
    expect(extractIsbn(["9780141439518_pride_and_prejudice.epub"])).toBe("9780141439518");
  });

  it("falls through candidates in order", () => {
    expect(extractIsbn([null, "no isbn here", "ISBN 9780441013593"])).toBe("9780441013593");
  });

  it("returns null when there's nothing ISBN-shaped", () => {
    expect(extractIsbn(["pride_and_prejudice.epub", null, undefined])).toBeNull();
  });
});

describe("lookupBookMetadata", () => {
  it("looks up by ISBN when the filename has one, and inlines the cover", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("openlibrary.org/api/books")) {
        expect(url).toContain("ISBN:9780141439518");
        return jsonResponse({
          "ISBN:9780141439518": {
            title: "Pride and Prejudice",
            authors: [{ name: "Jane Austen" }],
            cover: { medium: "https://covers.openlibrary.org/b/id/123-M.jpg" },
          },
        });
      }
      if (url.includes("covers.openlibrary.org")) return imageResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBookMetadata({ originalFilename: "9780141439518_pride_and_prejudice.epub" });

    expect(result?.title).toBe("Pride and Prejudice");
    expect(result?.author).toBe("Jane Austen");
    expect(result?.coverImageUrl).toMatch(/^data:image\/jpeg;base64,/);
    // No title search -- the ISBN hit was enough.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("search.json"))).toBe(false);
  });

  it("falls back to a title search when there's no ISBN", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("search.json")) {
        expect(url).toContain("title=the%20left%20hand%20of%20darkness");
        return jsonResponse({ docs: [{ title: "The Left Hand of Darkness", author_name: ["Ursula K. Le Guin"], cover_i: 99 }] });
      }
      if (url.includes("covers.openlibrary.org")) return imageResponse();
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBookMetadata({ originalFilename: "the-left-hand-of-darkness.pdf" });

    expect(result?.title).toBe("The Left Hand of Darkness");
    expect(result?.author).toBe("Ursula K. Le Guin");
  });

  it("falls back to a title search when the ISBN matches nothing", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/books")) return jsonResponse({});
      if (url.includes("search.json")) {
        return jsonResponse({ docs: [{ title: "Pride and Prejudice", author_name: ["Jane Austen"] }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBookMetadata({ originalFilename: "9780141439518_pride_and_prejudice.epub" });
    expect(result?.title).toBe("Pride and Prejudice");
  });

  it("finds an ISBN in the book's opening text when the filename has none", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("ISBN:9780441013593");
      return jsonResponse({ "ISBN:9780441013593": { title: "Dune", authors: [{ name: "Frank Herbert" }] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBookMetadata({
      originalFilename: "scan0001.pdf",
      text: "Ace Books edition\nISBN: 978-0-441-01359-3\nPrinted in the United States",
    });
    expect(result?.title).toBe("Dune");
  });

  it("returns null rather than throwing when Open Library is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(lookupBookMetadata({ originalFilename: "dune.epub" })).resolves.toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(lookupBookMetadata({ originalFilename: "dune.epub" })).resolves.toBeNull();
  });

  it("returns null when nothing matched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ docs: [] })));
    await expect(lookupBookMetadata({ originalFilename: "asdkjhaskdjh.epub" })).resolves.toBeNull();
  });

  it("drops Open Library's placeholder cover instead of storing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("covers.openlibrary.org")) return imageResponse(Buffer.alloc(43, 0)); // 1x1 placeholder
        return jsonResponse({ docs: [{ title: "Dune", author_name: ["Frank Herbert"], cover_i: 7 }] });
      }),
    );

    const result = await lookupBookMetadata({ originalFilename: "dune.epub" });
    expect(result?.title).toBe("Dune");
    expect(result?.coverImageUrl).toBeNull();
  });

  it("does not search on a filename that cleans down to noise", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ docs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupBookMetadata({ originalFilename: "a.epub" })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
