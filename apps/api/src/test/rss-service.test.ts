import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fetchFeed does a real DNS lookup to block SSRF -- stub it to a public IP
// so these tests exercise the fetch/parse logic itself, not DNS. Same
// pattern as extraction-service.test.ts.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const { fetchFeed, parseFeed, FeedFetchError } = await import("../services/rss-service.js");

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Example Feed</title>
<item><title>First Post</title><link>https://example.com/1</link><pubDate>Wed, 29 Jul 2026 12:00:00 GMT</pubDate><description>Hello &amp; world</description></item>
<item><title>Second Post</title><link>https://example.com/2</link><pubDate>Wed, 28 Jul 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title>
<entry><title>Atom Post</title><link href="https://example.com/atom1" rel="alternate"/><updated>2026-07-29T12:00:00Z</updated><summary>An atom summary</summary></entry>
</feed>`;

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/rss+xml" } });
}

describe("parseFeed", () => {
  it("parses an RSS 2.0 feed's title and items", () => {
    const result = parseFeed(RSS_XML);
    expect(result.title).toBe("Example Feed");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      title: "First Post",
      link: "https://example.com/1",
      publishedAt: "Wed, 29 Jul 2026 12:00:00 GMT",
      summary: "Hello & world",
    });
    expect(result.items[1].summary).toBeNull();
  });

  it("parses an Atom feed's title and entries", () => {
    const result = parseFeed(ATOM_XML);
    expect(result.title).toBe("Atom Feed");
    expect(result.items).toEqual([
      {
        title: "Atom Post",
        link: "https://example.com/atom1",
        publishedAt: "2026-07-29T12:00:00Z",
        summary: "An atom summary",
      },
    ]);
  });

  it("rejects something that isn't a feed at all", () => {
    expect(() => parseFeed("<html><body>not a feed</body></html>")).toThrow(FeedFetchError);
  });

  it("rejects malformed XML", () => {
    expect(() => parseFeed("<rss><channel><title>unterminated")).toThrow();
  });
});

describe("fetchFeed", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses a feed", async () => {
    fetchMock.mockResolvedValue(xmlResponse(RSS_XML));
    const result = await fetchFeed("https://example.com/feed.xml");
    expect(result.title).toBe("Example Feed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect, re-checking the new host", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example.com/feed.xml" } }))
      .mockResolvedValueOnce(xmlResponse(RSS_XML));
    const result = await fetchFeed("https://example.com/feed.xml");
    expect(result.title).toBe("Example Feed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-http(s) URL", async () => {
    await expect(fetchFeed("file:///etc/passwd")).rejects.toThrow(FeedFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a fetch failure as FeedFetchError", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(fetchFeed("https://example.com/feed.xml")).rejects.toThrow(FeedFetchError);
  });
});
