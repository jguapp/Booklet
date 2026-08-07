// A tiny static HTTP server serving article fixtures for the e2e suite.
//
// Why this exists: 31 of the suite's 47 spec files used to save a real
// Wikipedia URL, which meant every one of them performed a live network fetch
// plus a full Readability extraction, serialized behind Playwright's single
// worker. That -- not TTS generation, which only two specs exercise -- was
// what made the job slow enough to be switched off in CI.
//
// Almost none of those specs are testing extraction. They need *an article to
// exist* so they can test collections, trash, highlights, tags, and so on.
// Serving that article locally keeps exactly what each spec covers while
// removing the network from the critical path, and makes the content
// deterministic: a real Wikipedia page can be edited out from under a test
// asserting on its text.
//
// One spec (save-real-url.spec.ts) still fetches a genuine public URL, so
// real-world extraction stays covered.
//
// The API refuses to fetch loopback addresses by default (SSRF protection in
// extraction-service.ts). The e2e environment sets
// EXTRACTION_ALLOW_PRIVATE_ADDRESSES=true, which is ignored entirely when
// NODE_ENV=production.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.FIXTURE_SERVER_PORT || 4321);

/** Built rather than stored as files: the interesting variation between
 * fixtures is structural (how long, how many paragraphs, what shape the
 * opening sentence is), which is clearer expressed as parameters than as
 * eight nearly-identical HTML files. */
function articlePage({
  title,
  byline,
  paragraphs,
  siteName = "Booklet Test Fixtures",
  images = false,
  ogImage = false,
}) {
  const body = paragraphs
    .map((p, i) =>
      // Inserted after the first paragraph so Readability keeps it as part of
      // the article body rather than treating it as page furniture.
      images && i === 1
        ? `      <figure><img src="/images/sample.png" alt="A sample image" width="120" height="80"></figure>\n      <p>${p}</p>`
        : `      <p>${p}</p>`,
    )
    // Blank line between paragraphs, not just a newline. Extraction derives
    // its plain text from the DOM's own whitespace, and the paragraph-citation
    // feature counts `\n{2,}` boundaries to say which paragraph a highlight is
    // in -- so tightly-packed source HTML makes every citation "Paragraph 1".
    .join("\n\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta name="author" content="${byline}">
    <meta property="og:site_name" content="${siteName}">
    <meta name="description" content="${paragraphs[0].slice(0, 150)}">
${ogImage ? '    <meta property="og:image" content="/images/sample.png">\n' : ""}  </head>
  <body>
    <header><nav>Navigation that Readability should strip</nav></header>
    <article>
      <h1>${title}</h1>
      <!-- No visible byline element on purpose. Several specs highlight
           "the first paragraph" via [data-article-content] p:first, and a
           byline would silently become that paragraph -- Readability
           normalizes even a <div> byline into a <p> in its cleaned output,
           so avoiding <p> is not enough. The author reaches the app via
           <meta name="author"> above, which is where extraction reads it
           from regardless. -->
${body}
    </article>
    <footer>Footer that Readability should strip</footer>
  </body>
</html>`;
}

const LOREM = [
  "Readability is the ease with which a reader can understand a written text. In natural language, the readability of text depends on its content and its presentation.",
  "Researchers have used various factors to measure readability, such as speed of perception, perceptibility at a distance, perceptibility in peripheral vision, visibility, the reflex blink technique, rate of work, eye movement, and fatigue in reading.",
  "Readability is more than simply legibility, which is a measure of how easily a reader can distinguish individual letters or characters from each other. Higher readability eases reading effort and speed for any reader, but it is especially important for those who do not have high reading comprehension.",
  "In readers with average or poor reading comprehension, raising the readability level of a text from mediocre to good can make the difference between success and failure of its communication goals.",
  "Readability exists in both natural language and programming languages though in different forms. In programming, things such as programmer comments, choice of loop structure, and choice of names can determine the ease with which humans can read computer program code.",
];

const fixtures = {
  // The workhorse -- stands in for the URL the suite reached for most often.
  // Ordinary shape: a short opening sentence, several normal paragraphs.
  "/readability.html": articlePage({
    title: "Readability",
    byline: "Test Fixture Author",
    paragraphs: LOREM,
  }),

  // A second distinct article, for specs that need two different saves (tag
  // filtering, duplicate detection, collection membership). Carries a real
  // <img> so the image-inlining path (extraction rewrites remote images to
  // data: URIs) has something to actually inline.
  "/tagging.html": articlePage({
    images: true,
    // Carries og:image too, so the library-card thumbnail path has a real
    // social-preview image to pick up.
    ogImage: true,
    title: "Tag (metadata)",
    byline: "Second Fixture Author",
    paragraphs: [
      "In information systems, a tag is a keyword or term assigned to a piece of information. This kind of metadata helps describe an item and allows it to be found again by browsing or searching.",
      "Tags are generally chosen informally and personally by the item's creator or by its viewer, depending on the system, and are a form of user-generated metadata rather than part of a formal classification scheme.",
      "Tagging was popularized by websites associated with Web 2.0 and is an important feature of many services, including bookmarking sites, photo sharing services, and reading applications.",
    ],
  }),

  // Opens with a single sentence far longer than the first-chunk cap --
  // exercises the TTS chunker's first-chunk splitting against real extracted
  // text rather than only in unit tests.
  "/long-opening-sentence.html": articlePage({
    title: "A Long Opening Sentence",
    byline: "Third Fixture Author",
    paragraphs: [
      "The domestic dog is a domesticated descendant of the gray wolf, characterised by an upturned tail, and it has been selectively bred over millennia for various behaviours, sensory capabilities, and physical attributes, which is why it is now found in an extremely wide variety of breeds across the entire world today.",
      "Their long association with humans has led dogs to be uniquely attuned to human behavior, and they can thrive on a starch-rich diet that would be inadequate for other canids.",
      ...LOREM.slice(0, 2),
    ],
  }),

  // Deliberately long, for anything exercising scroll progress, reading-time
  // estimates, or a realistic chunk count.
  "/long-article.html": articlePage({
    title: "A Considerably Longer Article",
    byline: "Fourth Fixture Author",
    // Each paragraph *opens* with unique text rather than ending with it.
    // Highlight anchoring locates a selection by finding its text in the
    // article, so paragraphs that share an opening phrase make the first
    // occurrence win and every citation reads "Paragraph 1".
    paragraphs: Array.from(
      { length: 40 },
      (_, i) => `Section ${i + 1} of this article. ${LOREM[i % LOREM.length]}`,
    ),
  }),
};

// A real 1x1 PNG. Small enough to be inlined without tripping extraction's
// size limits, and genuinely decodable -- a placeholder that isn't valid PNG
// would be dropped rather than inlined, quietly defeating the test.
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/images/sample.png") {
    res.writeHead(200, { "content-type": "image/png", "content-length": SAMPLE_PNG.length });
    res.end(SAMPLE_PNG);
    return;
  }

  // Lets a spec assert the app's own failure handling without needing a real
  // unreachable host.
  if (url.pathname === "/not-an-article.html") {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body><p>Not found</p></body></html>");
    return;
  }

  const fixture = fixtures[url.pathname];
  if (fixture) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixture);
    return;
  }

  // Generic per-slug articles: /article/anything.html serves a valid,
  // distinct article whose title is derived from the slug. Specs frequently
  // need *several different* articles (duplicate detection, tag filtering,
  // library counts) and care only that the URLs differ -- this avoids adding
  // a named fixture every time one of those needs one more.
  const slugMatch = url.pathname.match(/^\/article\/([a-z0-9-]+)\.html$/i);
  if (slugMatch) {
    const slug = slugMatch[1];
    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      articlePage({
        title,
        byline: "Fixture Author",
        paragraphs: [`This article is about ${title}. ${LOREM[0]}`, ...LOREM.slice(1, 3)],
      }),
    );
    return;
  }

  // Anything under /static/ is served from disk, for the binary fixtures the
  // suite already keeps (PDF/EPUB) if a spec ever needs them over HTTP.
  if (url.pathname.startsWith("/static/")) {
    try {
      const file = await readFile(path.join(dir, "..", "fixtures", path.basename(url.pathname)));
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(file);
      return;
    } catch {
      /* fall through to 404 */
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("no such fixture");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[fixture-server] listening on http://127.0.0.1:${port}`);
});
