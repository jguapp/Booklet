import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTweetThread,
  parseTweetUrl,
  renderThreadHtml,
  threadTitle,
  threadToText,
} from "../services/twitter-extraction.js";

interface FakeTweet {
  id: string;
  text: string;
  handle?: string;
  name?: string;
  parent?: string;
  urls?: { url: string; expanded_url: string }[];
  mediaUrl?: string;
  photos?: string[];
}

/** Stubs the syndication endpoint with a fixed set of tweets, so nothing here
 * depends on x.com being reachable (or on a tweet continuing to exist). */
function stubSyndication(tweets: FakeTweet[]): ReturnType<typeof vi.fn> {
  const byId = new Map(tweets.map((t) => [t.id, t]));

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const id = new URL(String(input)).searchParams.get("id") ?? "";
    const tweet = byId.get(id);
    if (!tweet) return new Response("not found", { status: 404 });

    return new Response(
      JSON.stringify({
        id_str: tweet.id,
        text: tweet.text,
        created_at: "2026-01-01T00:00:00.000Z",
        user: { name: tweet.name ?? "Ada Lovelace", screen_name: tweet.handle ?? "ada" },
        entities: {
          urls: tweet.urls ?? [],
          media: tweet.mediaUrl ? [{ url: tweet.mediaUrl }] : [],
        },
        photos: (tweet.photos ?? []).map((url) => ({ url })),
        ...(tweet.parent ? { parent: { id_str: tweet.parent } } : {}),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseTweetUrl", () => {
  it("recognises the URL shapes X actually serves", () => {
    expect(parseTweetUrl("https://x.com/ada/status/123")).toBe("123");
    expect(parseTweetUrl("https://twitter.com/ada/status/123")).toBe("123");
    expect(parseTweetUrl("https://www.twitter.com/ada/status/123")).toBe("123");
    expect(parseTweetUrl("https://mobile.twitter.com/ada/status/123")).toBe("123");
    expect(parseTweetUrl("https://x.com/i/web/status/123")).toBe("123");
    expect(parseTweetUrl("https://twitter.com/ada/statuses/123")).toBe("123");
    expect(parseTweetUrl("https://x.com/ada/status/123?s=20&t=abc")).toBe("123");
    expect(parseTweetUrl("https://x.com/ada/status/123/photo/1")).toBe("123");
  });

  it("ignores anything that isn't a tweet", () => {
    expect(parseTweetUrl("https://x.com/ada")).toBeNull();
    expect(parseTweetUrl("https://example.com/ada/status/123")).toBeNull();
    expect(parseTweetUrl("https://notx.com/ada/status/123")).toBeNull();
    // A lookalike host must not match -- this decides whether we hand a URL
    // to a third-party endpoint.
    expect(parseTweetUrl("https://x.com.evil.test/ada/status/123")).toBeNull();
    expect(parseTweetUrl("not a url")).toBeNull();
  });
});

describe("fetchTweetThread", () => {
  it("reconstructs a self-reply chain in order, root first", async () => {
    stubSyndication([
      { id: "1", text: "One." },
      { id: "2", text: "Two.", parent: "1" },
      { id: "3", text: "Three.", parent: "2" },
    ]);

    const thread = await fetchTweetThread("3");
    expect(thread?.map((t) => t.text)).toEqual(["One.", "Two.", "Three."]);
  });

  it("stops at a different author -- a reply is a conversation, not a thread", async () => {
    stubSyndication([
      { id: "1", text: "Someone else's tweet.", handle: "grace" },
      { id: "2", text: "My reply to them.", handle: "ada", parent: "1" },
    ]);

    const thread = await fetchTweetThread("2");
    expect(thread?.map((t) => t.text)).toEqual(["My reply to them."]);
  });

  it("returns the single tweet when it has no parent", async () => {
    stubSyndication([{ id: "1", text: "Standalone." }]);
    const thread = await fetchTweetThread("1");
    expect(thread).toHaveLength(1);
  });

  it("stops cleanly when an ancestor is unavailable (deleted or protected)", async () => {
    stubSyndication([{ id: "2", text: "Reply whose parent is gone.", parent: "1" }]);
    const thread = await fetchTweetThread("2");
    expect(thread?.map((t) => t.text)).toEqual(["Reply whose parent is gone."]);
  });

  it("caps the walk so a self-referential chain can't loop", async () => {
    stubSyndication([
      { id: "1", text: "A.", parent: "2" },
      { id: "2", text: "B.", parent: "1" },
    ]);
    const thread = await fetchTweetThread("1");
    expect(thread!.length).toBeLessThanOrEqual(25);
  });

  it("returns null when the tweet itself can't be fetched", async () => {
    stubSyndication([]);
    await expect(fetchTweetThread("999")).resolves.toBeNull();
  });

  it("returns null rather than throwing when the endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(fetchTweetThread("1")).resolves.toBeNull();
  });

  it("expands t.co links and drops the media shortener", async () => {
    stubSyndication([
      {
        id: "1",
        text: "Read this https://t.co/abc and see https://t.co/pic",
        urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/real-article" }],
        mediaUrl: "https://t.co/pic",
        photos: ["https://pbs.twimg.com/media/1.jpg"],
      },
    ]);

    const thread = await fetchTweetThread("1");
    expect(thread![0].text).toContain("https://example.com/real-article");
    expect(thread![0].text).not.toContain("t.co");
    expect(thread![0].photos).toEqual(["https://pbs.twimg.com/media/1.jpg"]);
  });
});

describe("rendering", () => {
  const thread = [
    {
      id: "1",
      text: "First line\n\nSecond paragraph",
      authorName: "Ada Lovelace",
      authorHandle: "ada",
      createdAt: null,
      photos: ["https://pbs.twimg.com/media/1.jpg"],
    },
    { id: "2", text: "Tail <script>alert(1)</script>", authorName: "Ada Lovelace", authorHandle: "ada", createdAt: null, photos: [] },
  ];

  it("renders each tweet as its own block, with paragraphs and images", () => {
    const html = renderThreadHtml(thread);
    expect(html).toContain("<p>First line</p>");
    expect(html).toContain("<p>Second paragraph</p>");
    expect(html).toContain('<img src="https://pbs.twimg.com/media/1.jpg"');
    expect(html.match(/<section>/g)).toHaveLength(2);
  });

  it("escapes tweet text rather than emitting it as markup", () => {
    const html = renderThreadHtml(thread);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("joins the thread into continuous text and titles it from the opener", () => {
    expect(threadToText(thread)).toBe("First line\n\nSecond paragraph\n\nTail <script>alert(1)</script>");
    expect(threadTitle(thread)).toBe("First line");
  });

  it("falls back to a handle-based title when the opener has no text", () => {
    expect(threadTitle([{ ...thread[0], text: "" }])).toBe("Thread by @ada");
  });
});
