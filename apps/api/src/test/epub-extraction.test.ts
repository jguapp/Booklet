import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractEpubText } from "../services/epub-extraction.js";

// 1x1 PNG -- real, valid image bytes, just tiny (content doesn't matter,
// only that it round-trips as a data: URI with the right media type).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

interface ManifestItemOptions {
  id: string;
  href: string;
  mediaType?: string;
  properties?: string;
}

async function buildEpub(options: {
  extraManifestItems?: ManifestItemOptions[];
  coverMetaId?: string;
  images?: Record<string, Buffer>;
}): Promise<Buffer> {
  const { extraManifestItems = [], coverMetaId, images = {} } = options;
  const zip = new JSZip();

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const manifestXml = extraManifestItems
    .map(
      (item) =>
        `<item id="${item.id}" href="${item.href}"${item.mediaType ? ` media-type="${item.mediaType}"` : ""}${item.properties ? ` properties="${item.properties}"` : ""}/>`,
    )
    .join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:identifier id="bookid">urn:uuid:test-book</dc:identifier>
    ${coverMetaId ? `<meta name="cover" content="${coverMetaId}"/>` : ""}
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    ${manifestXml}
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`,
  );

  zip.file(
    "OEBPS/chapter1.xhtml",
    `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Enough chapter text to extract something real.</p></body></html>`,
  );

  for (const [href, data] of Object.entries(images)) {
    zip.file(`OEBPS/${href}`, data, { binary: true });
  }

  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractEpubText cover detection", () => {
  it("uses the EPUB3 manifest item marked properties=cover-image", async () => {
    const epub = await buildEpub({
      extraManifestItems: [{ id: "cover", href: "cover.png", mediaType: "image/png", properties: "cover-image" }],
      images: { "cover.png": TINY_PNG },
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back to the EPUB2 <meta name=\"cover\"> pointer when no cover-image property exists", async () => {
    const epub = await buildEpub({
      extraManifestItems: [{ id: "my-cover", href: "cover.png", mediaType: "image/png" }],
      coverMetaId: "my-cover",
      images: { "cover.png": TINY_PNG },
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back to the first image in the manifest when neither cover marker exists", async () => {
    const epub = await buildEpub({
      extraManifestItems: [{ id: "fig1", href: "figure1.png", mediaType: "image/png" }],
      images: { "figure1.png": TINY_PNG },
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("is null when the EPUB has no images at all", async () => {
    const epub = await buildEpub({});
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toBeNull();
  });

  it("is null when the declared cover image exceeds the size cap", async () => {
    const oversized = Buffer.alloc(600 * 1024, 1); // over the 512KB cap
    const epub = await buildEpub({
      extraManifestItems: [{ id: "cover", href: "cover.png", mediaType: "image/png", properties: "cover-image" }],
      images: { "cover.png": oversized },
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toBeNull();
  });

  it("is null when the declared cover item points at a file that isn't actually in the zip", async () => {
    const epub = await buildEpub({
      extraManifestItems: [{ id: "cover", href: "missing.png", mediaType: "image/png", properties: "cover-image" }],
    });
    const result = await extractEpubText(epub);
    expect(result.coverImageUrl).toBeNull();
  });
});
