/**
 * Generates the RSS 2.0 + iTunes-extensions document behind a personal
 * podcast feed (#154).
 *
 * This app already *parses* RSS (rss-service.ts, via JSDOM); this is the
 * other direction, and deliberately not built on the same tool. JSDOM's
 * XMLSerializer would mean constructing a whole document object to emit a
 * few hundred lines of known-shape markup, and the one thing that actually
 * has to be right here -- that every piece of interpolated user data is
 * escaped -- is easier to guarantee, and to test, as a single chokepoint
 * function than as a promise that every call site remembered createTextNode.
 *
 * Pure string-in/string-out with no database or request access, so the
 * escaping and the iTunes/enclosure structure can be tested against fixtures
 * without a server, a model, or any audio.
 */

/** Anything with a real <enclosure> to point at. An article whose audio has
 * not been generated yet gets no item in the feed at all -- see the caller in
 * routes/podcast.ts for why an enclosure-less item is worse than an absent
 * one. */
export interface PodcastEpisodeInput {
  articleId: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  /** The original article URL, for the item's <link>. Null for uploads. */
  link: string | null;
  savedAt: Date;
  readingTimeEstimate: number | null;
  excerpt: string | null;
  /** Article.coverImageUrl. Usually a data: URI -- see itunesImageTag. */
  coverImageUrl: string | null;
  audioUrl: string;
  audioBytes: number;
  audioDurationSeconds: number;
}

export interface PodcastChannelInput {
  title: string;
  description: string;
  /** Absolute URL of this feed. Required by <atom:link rel="self">, which
   * podcast validators treat as mandatory -- and which is also how a client
   * re-finds the feed after an OPML export/import round trip. Note this is
   * the secret URL: it sits inside the document, so the document is exactly
   * as sensitive as the URL that fetched it. */
  selfUrl: string;
  /** Where <link> points -- the web app, not the API. */
  siteUrl: string;
  authorName: string;
  /**
   * Absolute URL of the show's cover art.
   *
   * Apple requires channel-level `itunes:image` unconditionally and rejects a
   * feed without it -- not with an error a client surfaces, but by refusing
   * the show, which reads as "the feed just doesn't work". It has to be a
   * JPEG or PNG between 1400x1400 and 3000x3000; an SVG will not do, which is
   * why this app's own icon.svg cannot be reused for it.
   *
   * Null when PODCAST_ARTWORK_URL is unset. The feed stays valid RSS and every
   * third-party client this was tested against still subscribes and plays --
   * only Apple's directory is strict about it, and `itunes:block` already asks
   * not to be listed there. Deliberately not defaulted to a placeholder: a
   * broken image URL in a feed is worse than none, because clients cache it.
   */
  artworkUrl: string | null;
  buildDate: Date;
  episodes: readonly PodcastEpisodeInput[];
}

/**
 * The one place user data becomes markup.
 *
 * `&` and `<` are not hypothetical in article titles: headlines routinely
 * contain "&" ("Barnes & Noble", "R&D"), and "<" turns up in anything
 * technical ("a < b", "<script> tags considered harmful"). An unescaped `&`
 * alone makes the whole document fail to parse, and a podcast client's
 * response to an unparseable feed is to show nothing at all -- so a single
 * ampersand in one of fifty titles silently empties the entire subscription.
 *
 * Attribute delimiters are escaped too, because the same helper is used for
 * attribute values, where an unescaped quote closes the attribute early.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Strips the control characters XML 1.0 forbids outright -- they cannot be
 * escaped, only removed, so an entity reference is not a fix. Real extracted
 * text carries them: PDFs and OCR output produce stray form feeds and
 * vertical tabs, and those reach Article.title. One of them anywhere in the
 * document is a parse error, with the same all-or-nothing consequence as an
 * unescaped ampersand. Tab, newline and carriage return are the three that
 * are legal, and are kept.
 */
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function text(value: string): string {
  return escapeXml(value.replace(ILLEGAL_XML_CHARS, ""));
}

/**
 * RFC 822 date, as <pubDate> requires. `toUTCString()` already emits exactly
 * the RFC 1123 form ("Sat, 08 Aug 2026 10:00:00 GMT") that every feed reader
 * accepts, so there is no hand-rolled formatter here to get the day-name
 * abbreviations or the locale wrong.
 */
export function toRfc822(date: Date): string {
  return date.toUTCString();
}

/** <itunes:duration> as HH:MM:SS. The bare-seconds form is also legal, but
 * several clients display it verbatim, so a 40-minute article shows up in the
 * episode list as "2400". */
export function formatItunesDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/**
 * Episode artwork, but only when the cover is a real fetchable URL.
 *
 * Article.coverImageUrl is normally a base64 data: URI (see the schema
 * comment -- extraction inlines the thumbnail so the library grid works
 * offline). Two independent reasons that cannot go in a feed: no podcast
 * client resolves a data: URI in an image href, and fifty inlined thumbnails
 * would make the feed document several megabytes that every client
 * re-downloads on every poll. Dropping the tag costs a per-episode
 * thumbnail; including it would cost the feed.
 */
function itunesImageTag(coverImageUrl: string | null, indent: string): string | null {
  if (!coverImageUrl || !/^https?:\/\//i.test(coverImageUrl)) return null;
  return `${indent}<itunes:image href="${text(coverImageUrl)}" />`;
}

/**
 * WAV, because that is what the pipeline produces end to end (Kokoro ->
 * wav-pcm16.ts -> audio-concat.ts) with no transcoder anywhere in it. An
 * honest limitation rather than a preference: 16-bit PCM at 24 kHz is ~2.9 MB
 * per minute, so a 20-minute article is a ~57 MB download, which is rude to
 * push to a phone over cellular. The fix is a real codec (#153's Opus work),
 * not a different MIME type here.
 */
const ENCLOSURE_MIME = "audio/wav";

/** Built from metadata Article already has rather than from the article body:
 * a podcast client shows this in a cramped episode-notes pane, where the
 * useful thing is provenance and length -- what tells someone whether to
 * play it now. */
function describe(episode: PodcastEpisodeInput): string {
  const parts: string[] = [];
  if (episode.excerpt?.trim()) parts.push(episode.excerpt.trim());
  const meta = [
    episode.siteName?.trim() || null,
    episode.readingTimeEstimate ? `${episode.readingTimeEstimate} min read` : null,
    episode.link,
  ].filter((value): value is string => Boolean(value));
  if (meta.length > 0) parts.push(meta.join(" · "));
  return parts.join("\n\n");
}

function buildItem(episode: PodcastEpisodeInput): string {
  const title = episode.title?.trim() || "Untitled";
  const author = episode.author?.trim() || episode.siteName?.trim() || null;
  const description = describe(episode);

  const lines: (string | null)[] = [
    "    <item>",
    `      <title>${text(title)}</title>`,
    episode.link ? `      <link>${text(episode.link)}</link>` : null,
    // isPermaLink="false", keyed on the article id rather than the audio URL:
    // the guid is a client's identity for an episode, so it has to survive
    // the audio being regenerated (a voice change rebuilds the file). Keying
    // it on anything that changes makes every regeneration look like a brand
    // new episode and re-downloads the entire back catalogue.
    `      <guid isPermaLink="false">booklet-article-${text(episode.articleId)}</guid>`,
    `      <pubDate>${toRfc822(episode.savedAt)}</pubDate>`,
    // url/length/type are all three mandatory on <enclosure>. length is the
    // one that is easy to get wrong and easy to miss: clients use it for the
    // download progress bar before a byte has arrived, and some refuse an
    // enclosure without it outright.
    `      <enclosure url="${text(episode.audioUrl)}" length="${episode.audioBytes}" type="${ENCLOSURE_MIME}" />`,
    `      <itunes:duration>${formatItunesDuration(episode.audioDurationSeconds)}</itunes:duration>`,
    "      <itunes:explicit>false</itunes:explicit>",
    author ? `      <itunes:author>${text(author)}</itunes:author>` : null,
    description ? `      <description>${text(description)}</description>` : null,
    description ? `      <itunes:summary>${text(description)}</itunes:summary>` : null,
    itunesImageTag(episode.coverImageUrl, "      "),
    "    </item>",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

export function buildPodcastFeedXml(channel: PodcastChannelInput): string {
  const items = channel.episodes.map(buildItem);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    // The itunes namespace has to be declared on <rss> or every itunes:*
    // element below is a namespace error and the document does not parse.
    // atom is here purely for <atom:link rel="self">.
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${text(channel.title)}</title>`,
    `    <link>${text(channel.siteUrl)}</link>`,
    `    <description>${text(channel.description)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${toRfc822(channel.buildDate)}</lastBuildDate>`,
    "    <generator>Booklet</generator>",
    `    <atom:link href="${text(channel.selfUrl)}" rel="self" type="application/rss+xml" />`,
    `    <itunes:author>${text(channel.authorName)}</itunes:author>`,
    `    <itunes:summary>${text(channel.description)}</itunes:summary>`,
    "    <itunes:explicit>false</itunes:explicit>",
    "    <itunes:type>episodic</itunes:type>",
    // <itunes:block> keeps this out of the Apple Podcasts directory if the
    // URL ever escapes into a crawler. It is a request rather than an
    // enforcement mechanism -- the token is the actual protection -- but a
    // private feed being indexed is a bad enough outcome to ask.
    "    <itunes:block>Yes</itunes:block>",
    // Required by Apple's own validator even though this feed is never
    // submitted anywhere. "News" is the least-wrong bucket for a personal
    // read-it-later queue; nothing reads it.
    '    <itunes:category text="News" />',
    // Both spellings of the same artwork. itunes:image is what Apple and most
    // modern clients read; the RSS 2.0 <image> block is what older ones fall
    // back to, and costs three lines to satisfy.
    ...(channel.artworkUrl
      ? [
          `    <itunes:image href="${text(channel.artworkUrl)}" />`,
          "    <image>",
          `      <url>${text(channel.artworkUrl)}</url>`,
          `      <title>${text(channel.title)}</title>`,
          `      <link>${text(channel.siteUrl)}</link>`,
          "    </image>",
        ]
      : []),
    ...items,
    "  </channel>",
    "</rss>",
  ];
  return `${lines.join("\n")}\n`;
}
