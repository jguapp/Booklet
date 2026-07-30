import JSZip from "jszip";
import { JSDOM } from "jsdom";

export class EpubExtractionError extends Error {}

export interface EpubExtractionResult {
  title: string | null;
  text: string;
  readingTimeEstimate: number;
  /** data: URI of the EPUB's declared cover (or its first spine image as a
   * fallback), for the library card. Null if there wasn't one/it couldn't
   * be read -- cosmetic, never worth failing the whole upload over. */
  coverImageUrl: string | null;
}

const WORDS_PER_MINUTE = 200;
// The cover thumbnail loads on every library card, not just this one
// article's own reader view -- kept far smaller than what a body image
// would need to be.
const MAX_COVER_IMAGE_BYTES = 512 * 1024; // 512KB

interface ManifestItem {
  href: string;
  mediaType: string | null;
  properties: string | null;
}

function resolveRelativePath(base: string, relative: string): string {
  const baseDir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const parts = (baseDir + relative).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

async function readZipText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);
  if (!file) throw new EpubExtractionError(`Missing file in EPUB: ${filePath}`);
  return file.async("string");
}

/** EPUB3 marks the cover via a manifest item's properties="cover-image";
 * EPUB2 instead points to it via a <meta name="cover" content="ID">, where
 * ID is a manifest item's id. Falls back to the first image in the
 * manifest if neither is present -- better than no cover at all. */
function findCoverManifestItem(opfDoc: Document, manifest: Map<string, ManifestItem>): ManifestItem | null {
  for (const item of manifest.values()) {
    if (item.properties?.split(/\s+/).includes("cover-image")) return item;
  }

  const coverMetaId = opfDoc.querySelector('metadata > meta[name="cover"]')?.getAttribute("content");
  const coverItem = coverMetaId ? manifest.get(coverMetaId) : undefined;
  if (coverItem) return coverItem;

  for (const item of manifest.values()) {
    if (item.mediaType?.startsWith("image/")) return item;
  }
  return null;
}

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

async function extractCoverImage(zip: JSZip, opfPath: string, item: ManifestItem): Promise<string | null> {
  const mediaType = item.mediaType || EXTENSION_MEDIA_TYPES[item.href.toLowerCase().split(".").pop() ?? ""];
  if (!mediaType) return null;

  const imagePath = resolveRelativePath(opfPath, item.href);
  const file = zip.file(imagePath);
  if (!file) return null;

  const buffer = await file.async("nodebuffer");
  if (buffer.length === 0 || buffer.length > MAX_COVER_IMAGE_BYTES) return null;

  return `data:${mediaType};base64,${buffer.toString("base64")}`;
}

export async function extractEpubText(data: Buffer): Promise<EpubExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new EpubExtractionError(err instanceof Error ? err.message : "Failed to open that EPUB (not a valid zip).");
  }

  const containerXml = await readZipText(zip, "META-INF/container.xml").catch(() => {
    throw new EpubExtractionError("Missing META-INF/container.xml -- not a valid EPUB.");
  });
  const containerDoc = new JSDOM(containerXml, { contentType: "text/xml" }).window.document;
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new EpubExtractionError("Couldn't find the EPUB's content file (rootfile).");

  const opfXml = await readZipText(zip, opfPath);
  const opfDoc = new JSDOM(opfXml, { contentType: "text/xml" }).window.document;

  const title = opfDoc.querySelector("metadata > title, dc\\:title")?.textContent?.trim() || null;

  const manifest = new Map<string, ManifestItem>(); // id -> item
  opfDoc.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, {
        href,
        mediaType: item.getAttribute("media-type"),
        properties: item.getAttribute("properties"),
      });
    }
  });

  const coverItem = findCoverManifestItem(opfDoc, manifest);
  const coverImageUrl = coverItem ? await extractCoverImage(zip, opfPath, coverItem).catch(() => null) : null;

  const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref"))
    .map((item) => item.getAttribute("idref"))
    .filter((id): id is string => !!id);

  if (spineIds.length === 0) throw new EpubExtractionError("This EPUB's spine is empty.");

  const chapterTexts: string[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id)?.href;
    if (!href) continue;
    const chapterPath = resolveRelativePath(opfPath, href);
    const chapterHtml = await readZipText(zip, chapterPath).catch(() => null);
    if (!chapterHtml) continue;

    const chapterDoc = new JSDOM(chapterHtml).window.document;
    const text = (chapterDoc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) chapterTexts.push(text);
  }

  const text = chapterTexts.join("\n\n");
  if (!text.trim()) {
    throw new EpubExtractionError("Couldn't find any extractable text in that EPUB.");
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const readingTimeEstimate = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

  return { title, text, readingTimeEstimate, coverImageUrl };
}
