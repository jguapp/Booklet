import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractEpubText } from "../services/epub-extraction.js";

/**
 * A manifest `href` is a URL, so the OPF spec requires reserved characters in
 * it to be percent-encoded: a book whose chapter file is named
 * "chapter 1.xhtml" ships `href="chapter%201.xhtml"`. The zip entry keeps the
 * literal name, so looking it up by the raw href misses -- and both call
 * sites swallow a miss (a chapter is skipped by `continue`, the cover falls
 * back to null), which is what makes this silent instead of loud.
 *
 * Not an exotic shape: spaces and non-ASCII characters in internal filenames
 * are ordinary in real books, particularly Calibre and Word exports.
 */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface Chapter {
  /** The literal zip entry name, under OEBPS/. */
  fileName: string;
  /** What the manifest advertises -- normally the percent-encoded fileName. */
  href: string;
  text: string;
}

async function buildEpub(options: {
  chapters: Chapter[];
  coverFileName?: string;
  coverHref?: string;
}): Promise<Buffer> {
  const { chapters, coverFileName, coverHref } = options;
  const zip = new JSZip();

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const manifest = chapters
    .map((c, i) => `<item id="c${i}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .concat(coverHref ? [`<item id="cover" href="${coverHref}" media-type="image/png" properties="cover-image"/>`] : [])
    .join("\n    ");
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:identifier id="bookid">urn:uuid:test-book</dc:identifier>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`,
  );

  for (const chapter of chapters) {
    zip.file(
      `OEBPS/${chapter.fileName}`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>${chapter.text}</p></body></html>`,
    );
  }
  if (coverFileName) zip.file(`OEBPS/${coverFileName}`, TINY_PNG, { binary: true });

  return zip.generateAsync({ type: "nodebuffer" });
}

describe("EPUB manifest hrefs are URLs, not zip entry names", () => {
  it("reads a chapter whose filename is percent-encoded in the manifest", async () => {
    // Before the fix: "Couldn't find any extractable text in that EPUB" -- the
    // upload was rejected outright for a perfectly valid book.
    const epub = await buildEpub({
      chapters: [
        {
          fileName: "chapter 1.xhtml",
          href: "chapter%201.xhtml",
          text: "The quick brown fox jumps over the lazy dog, at length.",
        },
      ],
    });
    const result = await extractEpubText(epub);
    expect(result.text).toContain("The quick brown fox");
  });

  it("does not silently drop only the encoded chapters of a mixed book", async () => {
    // The quieter half of the same bug: the book still imports, just missing
    // whichever chapters happened to need encoding.
    const epub = await buildEpub({
      chapters: [
        { fileName: "one.xhtml", href: "one.xhtml", text: "Chapter one is plainly named." },
        { fileName: "chapter two.xhtml", href: "chapter%20two.xhtml", text: "Chapter two has a space." },
        { fileName: "résumé.xhtml", href: "r%C3%A9sum%C3%A9.xhtml", text: "Chapter three is not ASCII." },
      ],
    });
    const result = await extractEpubText(epub);
    expect(result.text).toContain("Chapter one is plainly named.");
    expect(result.text).toContain("Chapter two has a space.");
    expect(result.text).toContain("Chapter three is not ASCII.");
  });

  it("finds a cover image whose href is percent-encoded", async () => {
    const epub = await buildEpub({
      chapters: [{ fileName: "one.xhtml", href: "one.xhtml", text: "Some body text to extract." }],
      coverFileName: "cover art.png",
      coverHref: "cover%20art.png",
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("still reads a chapter whose filename contains a literal, un-escaped %", async () => {
    // "100%.xhtml" is a legal filename and illegal percent-encoding, so a
    // blind decodeURIComponent throws on it. The raw name is the fallback.
    const epub = await buildEpub({
      chapters: [{ fileName: "100%.xhtml", href: "100%.xhtml", text: "Completed, entirely and utterly." }],
    });
    const result = await extractEpubText(epub);
    expect(result.text).toContain("Completed, entirely and utterly.");
  });

  it("ignores a fragment on a spine href rather than treating it as part of the filename", async () => {
    const epub = await buildEpub({
      chapters: [
        { fileName: "whole-book.xhtml", href: "whole-book.xhtml#part-one", text: "Part one, of a single-file book." },
      ],
    });
    const result = await extractEpubText(epub);
    expect(result.text).toContain("Part one, of a single-file book.");
  });
});
