import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  buildPodcastFeedXml,
  escapeXml,
  formatItunesDuration,
  toRfc822,
  type PodcastChannelInput,
  type PodcastEpisodeInput,
} from "../services/podcast-feed.js";

/**
 * The feed is parsed back with JSDOM in XML mode -- the same parser
 * rss-service.ts uses to read other people's feeds -- rather than asserted
 * against expected substrings. Substring assertions pass happily on a
 * document that no client can actually parse, which is the exact failure
 * mode that matters here: a podcast client's response to malformed XML is to
 * show an empty subscription, not an error.
 */

const SAVED_AT = new Date("2026-08-01T09:30:00Z");

function episode(overrides: Partial<PodcastEpisodeInput> = {}): PodcastEpisodeInput {
  return {
    articleId: "art_1",
    title: "The Untold History of Type",
    author: "Jane Roe",
    siteName: "Example Review",
    link: "https://example.com/type",
    savedAt: SAVED_AT,
    readingTimeEstimate: 12,
    excerpt: "A short excerpt.",
    coverImageUrl: null,
    audioUrl: "https://api.example.com/podcast/bkpod_abc/episodes/art_1/audio.wav",
    audioBytes: 5_242_880,
    audioDurationSeconds: 754,
    ...overrides,
  };
}

function channel(overrides: Partial<PodcastChannelInput> = {}): PodcastChannelInput {
  return {
    title: "Booklet — your reading queue",
    description: "Articles saved to Booklet, read aloud.",
    selfUrl: "https://api.example.com/podcast/bkpod_abc/feed.xml",
    siteUrl: "https://booklet.example.com",
    authorName: "Booklet",
    artworkUrl: null,
    buildDate: new Date("2026-08-08T00:00:00Z"),
    episodes: [episode()],
    ...overrides,
  };
}

const ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
const ATOM_NS = "http://www.w3.org/2005/Atom";

function parse(xml: string): Document {
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const doc = dom.window.document;
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`Feed did not parse: ${error.textContent}`);
  return doc;
}

describe("buildPodcastFeedXml", () => {
  it("produces a parseable RSS 2.0 document with the itunes and atom namespaces bound", () => {
    const doc = parse(buildPodcastFeedXml(channel()));

    expect(doc.documentElement.nodeName).toBe("rss");
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");
    // Bound on <rss> itself -- without the declaration every itunes:* element
    // below is a namespace error, not just an unrecognized tag.
    expect(doc.getElementsByTagNameNS(ITUNES_NS, "author").length).toBeGreaterThan(0);
    expect(doc.getElementsByTagNameNS(ATOM_NS, "link").length).toBe(1);
  });

  it("carries every channel element Apple requires, or the feed is silently rejected", () => {
    const doc = parse(buildPodcastFeedXml(channel()));
    const ch = doc.querySelector("channel")!;

    // Apple's directory rejects a feed missing any of these, and a podcast
    // client's response is an empty subscription rather than an error -- so
    // dropping one would look like "the feed just doesn't work" with nothing
    // pointing at the cause. The other tests here prove the document parses;
    // parsing is not the same as being accepted, which is what this guards.
    for (const tag of ["title", "link", "description", "language"]) {
      expect(ch.querySelector(tag)?.textContent?.trim(), `<${tag}> missing`).toBeTruthy();
    }
    for (const tag of ["author", "explicit", "category"]) {
      const el = ch.getElementsByTagNameNS(ITUNES_NS, tag)[0];
      expect(el, `<itunes:${tag}> missing`).toBeTruthy();
    }

    // itunes:category carries its value in an attribute, not as text, so "the
    // element exists" is not enough to be valid.
    expect(ch.getElementsByTagNameNS(ITUNES_NS, "category")[0].getAttribute("text")).toBeTruthy();
    // explicit must be the literal "true"/"false" -- Apple rejects "no"/"yes".
    expect(["true", "false"]).toContain(
      ch.getElementsByTagNameNS(ITUNES_NS, "explicit")[0].textContent?.trim(),
    );
  });

  describe("show artwork", () => {
    it("emits both spellings of the cover art when one is configured", () => {
      const url = "https://cdn.example.com/booklet-cover-1400.png";
      const doc = parse(buildPodcastFeedXml(channel({ artworkUrl: url })));
      const ch = doc.querySelector("channel")!;

      // Apple reads itunes:image; older clients read the RSS 2.0 <image>
      // block. Emitting one and not the other loses artwork in whichever set
      // of clients reads the missing one.
      expect(ch.getElementsByTagNameNS(ITUNES_NS, "image")[0]?.getAttribute("href")).toBe(url);
      expect(ch.querySelector("image > url")?.textContent).toBe(url);
    });

    it("stays valid RSS with no artwork configured, rather than emitting an empty href", () => {
      const doc = parse(buildPodcastFeedXml(channel({ artworkUrl: null })));
      const ch = doc.querySelector("channel")!;
      // A present-but-empty href is worse than absence: clients cache the
      // broken image and stop retrying.
      expect(ch.getElementsByTagNameNS(ITUNES_NS, "image").length).toBe(0);
      expect(ch.querySelector("image")).toBeNull();
      expect(ch.querySelector("title")?.textContent).toBeTruthy();
    });
  });

  it("gives every item the elements a client needs to list and order it", () => {
    const doc = parse(buildPodcastFeedXml(channel()));
    const item = doc.querySelector("item")!;
    for (const tag of ["title", "enclosure", "guid", "pubDate"]) {
      expect(item.querySelector(tag), `<${tag}> missing from item`).toBeTruthy();
    }
    // An unparseable pubDate sorts an episode to the epoch in most clients,
    // which buries it at the bottom of the list forever.
    expect(Number.isNaN(Date.parse(item.querySelector("pubDate")!.textContent!))).toBe(false);
  });

  it("declares the feed's own URL in atom:link rel=self, which validators require", () => {
    const doc = parse(buildPodcastFeedXml(channel()));
    const self = doc.getElementsByTagNameNS(ATOM_NS, "link")[0];

    expect(self.getAttribute("rel")).toBe("self");
    expect(self.getAttribute("type")).toBe("application/rss+xml");
    expect(self.getAttribute("href")).toBe("https://api.example.com/podcast/bkpod_abc/feed.xml");
  });

  it("gives every item all three mandatory enclosure attributes", () => {
    const doc = parse(buildPodcastFeedXml(channel()));
    const enclosure = doc.querySelector("item > enclosure")!;

    expect(enclosure.getAttribute("url")).toBe(
      "https://api.example.com/podcast/bkpod_abc/episodes/art_1/audio.wav",
    );
    expect(enclosure.getAttribute("length")).toBe("5242880");
    expect(enclosure.getAttribute("type")).toBe("audio/wav");
  });

  it("carries the Article metadata the issue asked to reuse", () => {
    const doc = parse(buildPodcastFeedXml(channel()));
    const item = doc.querySelector("item")!;

    expect(item.querySelector("title")!.textContent).toBe("The Untold History of Type");
    expect(item.querySelector("link")!.textContent).toBe("https://example.com/type");
    expect(item.querySelector("pubDate")!.textContent).toBe("Sat, 01 Aug 2026 09:30:00 GMT");
    expect(item.getElementsByTagNameNS(ITUNES_NS, "author")[0].textContent).toBe("Jane Roe");
    expect(item.getElementsByTagNameNS(ITUNES_NS, "duration")[0].textContent).toBe("00:12:34");
    expect(item.querySelector("description")!.textContent).toContain("Example Review");
    expect(item.querySelector("description")!.textContent).toContain("12 min read");
  });

  it("keys the guid on the article, not the audio, so regeneration is not a new episode", () => {
    const guid = parse(buildPodcastFeedXml(channel())).querySelector("guid")!;
    expect(guid.getAttribute("isPermaLink")).toBe("false");
    expect(guid.textContent).toBe("booklet-article-art_1");

    const rebuilt = parse(
      buildPodcastFeedXml(channel({ episodes: [episode({ audioUrl: "https://api.example.com/other.wav" })] })),
    ).querySelector("guid")!;
    expect(rebuilt.textContent).toBe(guid.textContent);
  });

  describe("escaping", () => {
    it("survives the ampersands and angle brackets real titles contain", () => {
      const doc = parse(
        buildPodcastFeedXml(
          channel({
            episodes: [
              episode({
                title: "Barnes & Noble, R&D, and why a < b",
                author: "O'Neill & Sons",
                siteName: '"Quoted" Weekly',
                excerpt: "Use <script> tags carefully & sparingly.",
              }),
            ],
          }),
        ),
      );
      const item = doc.querySelector("item")!;

      // Parsed back out, the text is the original -- which is the only
      // assertion that proves both that it was escaped and that it round
      // trips rather than being double-escaped.
      expect(item.querySelector("title")!.textContent).toBe("Barnes & Noble, R&D, and why a < b");
      expect(item.getElementsByTagNameNS(ITUNES_NS, "author")[0].textContent).toBe("O'Neill & Sons");
      expect(item.querySelector("description")!.textContent).toContain("Use <script> tags carefully & sparingly.");
      expect(item.querySelector("description")!.textContent).toContain('"Quoted" Weekly');
    });

    it("escapes quotes inside attribute values", () => {
      const doc = parse(
        buildPodcastFeedXml(
          channel({
            episodes: [
              episode({
                audioUrl: 'https://api.example.com/a.wav?q="x"&y=1',
                coverImageUrl: "https://img.example.com/c.jpg?a=1&b=2",
              }),
            ],
          }),
        ),
      );

      expect(doc.querySelector("enclosure")!.getAttribute("url")).toBe('https://api.example.com/a.wav?q="x"&y=1');
      expect(doc.getElementsByTagNameNS(ITUNES_NS, "image")[0].getAttribute("href")).toBe(
        "https://img.example.com/c.jpg?a=1&b=2",
      );
    });

    it("strips control characters, which cannot be escaped at all", () => {
      // A form feed or vertical tab from a PDF/OCR extraction is not an
      // entity-encodable character in XML 1.0 -- one of them anywhere makes
      // the whole document unparseable.
      const doc = parse(
        buildPodcastFeedXml(channel({ episodes: [episode({ title: "Page\u000COne\u0000Two\u001FEnd" })] })),
      );
      expect(doc.querySelector("item > title")!.textContent).toBe("PageOneTwoEnd");
    });

    it("escapes the channel-level strings too", () => {
      const doc = parse(buildPodcastFeedXml(channel({ title: "Q & A <live>" })));
      expect(doc.querySelector("channel > title")!.textContent).toBe("Q & A <live>");
    });
  });

  describe("artwork", () => {
    it("emits itunes:image for a fetchable http(s) cover", () => {
      const doc = parse(
        buildPodcastFeedXml(
          channel({ episodes: [episode({ coverImageUrl: "https://img.example.com/cover.png" })] }),
        ),
      );
      expect(doc.getElementsByTagNameNS(ITUNES_NS, "image")[0].getAttribute("href")).toBe(
        "https://img.example.com/cover.png",
      );
    });

    it("drops a data: URI cover -- no client resolves one, and inlining fifty bloats the feed", () => {
      const dataUri = `data:image/png;base64,${"A".repeat(4000)}`;
      const xml = buildPodcastFeedXml(channel({ episodes: [episode({ coverImageUrl: dataUri })] }));

      expect(parse(xml).getElementsByTagNameNS(ITUNES_NS, "image").length).toBe(0);
      expect(xml).not.toContain("data:image/png");
    });
  });

  describe("missing metadata", () => {
    it("falls back to a title and omits tags with nothing to say", () => {
      const doc = parse(
        buildPodcastFeedXml(
          channel({
            episodes: [
              episode({
                title: null,
                author: null,
                siteName: null,
                link: null,
                excerpt: null,
                readingTimeEstimate: null,
              }),
            ],
          }),
        ),
      );
      const item = doc.querySelector("item")!;

      expect(item.querySelector("title")!.textContent).toBe("Untitled");
      expect(item.querySelector("link")).toBeNull();
      expect(item.querySelector("description")).toBeNull();
      expect(item.getElementsByTagNameNS(ITUNES_NS, "author").length).toBe(0);
      // The enclosure is the one thing that must survive every fallback --
      // without it the item is not an episode.
      expect(item.querySelector("enclosure")).not.toBeNull();
    });

    it("uses the site name as the author when the article has none", () => {
      const doc = parse(
        buildPodcastFeedXml(channel({ episodes: [episode({ author: null, siteName: "Example Review" })] })),
      );
      expect(doc.querySelector("item")!.getElementsByTagNameNS(ITUNES_NS, "author")[0].textContent).toBe(
        "Example Review",
      );
    });
  });

  it("stays a valid, empty channel when nothing has audio yet", () => {
    // The state a brand-new subscription is in while the backlog generates.
    const doc = parse(buildPodcastFeedXml(channel({ episodes: [] })));
    expect(doc.querySelectorAll("item").length).toBe(0);
    expect(doc.querySelector("channel > title")).not.toBeNull();
  });

  it("emits items in the order given", () => {
    const doc = parse(
      buildPodcastFeedXml(
        channel({
          episodes: [episode({ articleId: "a", title: "First" }), episode({ articleId: "b", title: "Second" })],
        }),
      ),
    );
    expect(Array.from(doc.querySelectorAll("item > title")).map((n) => n.textContent)).toEqual(["First", "Second"]);
  });
});

describe("formatItunesDuration", () => {
  it("pads to HH:MM:SS so clients do not display raw seconds", () => {
    expect(formatItunesDuration(0)).toBe("00:00:00");
    expect(formatItunesDuration(9)).toBe("00:00:09");
    expect(formatItunesDuration(754)).toBe("00:12:34");
    expect(formatItunesDuration(3600)).toBe("01:00:00");
    expect(formatItunesDuration(45296)).toBe("12:34:56");
  });

  it("clamps rather than emitting a negative duration", () => {
    expect(formatItunesDuration(-5)).toBe("00:00:00");
  });
});

describe("toRfc822", () => {
  it("emits the RFC 1123 form pubDate requires", () => {
    expect(toRfc822(new Date("2026-08-01T09:30:00Z"))).toBe("Sat, 01 Aug 2026 09:30:00 GMT");
  });
});

describe("escapeXml", () => {
  it("escapes each of the five predefined entities exactly once", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("does not double-escape an already-escaped ampersand", () => {
    // The input is literal text, so "&amp;" in it really is five characters
    // and must come back out as five characters.
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });
});
