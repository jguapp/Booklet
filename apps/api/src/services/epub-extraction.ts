import JSZip from "jszip";
import { JSDOM } from "jsdom";

export class EpubExtractionError extends Error {}

export interface EpubExtractionResult {
  title: string | null;
  text: string;
  readingTimeEstimate: number;
}

const WORDS_PER_MINUTE = 200;

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

  const manifest = new Map<string, string>(); // id -> href
  opfDoc.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  });

  const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref"))
    .map((item) => item.getAttribute("idref"))
    .filter((id): id is string => !!id);

  if (spineIds.length === 0) throw new EpubExtractionError("This EPUB's spine is empty.");

  const chapterTexts: string[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
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

  return { title, text, readingTimeEstimate };
}
