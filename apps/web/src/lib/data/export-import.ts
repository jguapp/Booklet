/**
 * Export: one Markdown file per article (frontmatter + body + highlights),
 * zipped -- directly usable as an Obsidian vault import, and importable
 * into Notion (which accepts Markdown/zip import natively). No live Notion
 * API sync: that needs an integration token this app has no way to obtain
 * on someone's behalf, so Markdown is the actual deliverable for both.
 *
 * Import: Pocket and Instapaper both export a CSV with (at minimum) a URL
 * column -- parsed leniently by header name rather than a fixed column
 * order, since the two services don't use the same layout.
 */
import type { Article, Highlight } from "@booklet/shared";
import { KINDLE_HIGHLIGHT_COLOR, parseKindleClippings } from "@booklet/shared";
import { getOrCreateBookArticle, loadArticles, loadArticlesWithText, saveArticleFromUrl } from "./articles";
import { createHighlight, loadHighlights } from "./highlights";
import { ApiError } from "@/lib/api/client";

function frontmatterEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

function articleToMarkdown(article: Article, highlights: Highlight[]): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${frontmatterEscape(article.title ?? "Untitled")}"`);
  if (article.url) lines.push(`url: "${frontmatterEscape(article.url)}"`);
  lines.push(`savedAt: ${article.savedAt}`);
  if (article.tags.length > 0) lines.push(`tags: [${article.tags.map((t) => `"${frontmatterEscape(t)}"`).join(", ")}]`);
  lines.push("---", "");
  lines.push(`# ${article.title ?? "Untitled"}`, "");
  if (article.url) lines.push(`Source: ${article.url}`, "");

  if (article.extractedText) {
    lines.push(article.extractedText.trim(), "");
  }

  if (highlights.length > 0) {
    lines.push("## Highlights", "");
    for (const h of highlights) {
      lines.push(`> ${h.selectedText.trim()}`);
      if (h.annotation?.noteText) lines.push("", h.annotation.noteText.trim());
      lines.push("");
    }
  }

  return lines.join("\n");
}

function safeFilename(title: string | null, id: string): string {
  const base = (title ?? "untitled").trim().slice(0, 80).replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${base || "untitled"}-${id.slice(0, 8)}.md`;
}

export async function exportAsMarkdownZip(authenticated: boolean): Promise<void> {
  // Imported here rather than at the top of the module: JSZip is the single
  // heaviest thing this file pulls in, and nothing else in it -- the CSV,
  // bookmarks and Kindle importers, the Anki export -- touches a zip at all.
  // A static import put it in the Import/Export page's own bundle for
  // everyone who opens that page, including the majority who came to import
  // something. Now it is fetched by the click that actually needs it.
  const { default: JSZip } = await import("jszip");
  // loadArticlesWithText, not loadArticles: signed in, the latter answers
  // with summaries that carry no extractedText, so every exported file came
  // out as frontmatter and highlights with the article body missing.
  const [articles, highlights] = await Promise.all([
    loadArticlesWithText(authenticated),
    loadHighlights(authenticated),
  ]);
  const highlightsByArticle = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const list = highlightsByArticle.get(h.articleId) ?? [];
    list.push(h);
    highlightsByArticle.set(h.articleId, list);
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const article of articles) {
    let name = safeFilename(article.title, article.id);
    while (usedNames.has(name)) name = `${name.replace(/\.md$/, "")}-x.md`;
    usedNames.add(name);
    zip.file(name, articleToMarkdown(article, highlightsByArticle.get(article.id) ?? []));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `booklet-export-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Anki's own plain-text importer (File > Import) reads this directly, no
 * plugin needed: `#`-prefixed header lines configure the field separator
 * and whether fields may contain HTML, then one card per line. Newlines
 * within a field aren't allowed in this format, so a multi-line note
 * becomes `<br>`-joined instead (safe given `#html:true`). */
function ankiFieldEscape(text: string): string {
  return text.trim().replace(/\t/g, " ").replace(/\r\n|\r|\n/g, "<br>");
}

export async function exportAsAnkiText(authenticated: boolean): Promise<void> {
  const [articles, highlights] = await Promise.all([loadArticles(authenticated), loadHighlights(authenticated)]);
  const articleById = new Map(articles.map((a) => [a.id, a]));

  const lines = ["#separator:tab", "#html:true"];
  for (const h of highlights) {
    const article = articleById.get(h.articleId);
    const front = ankiFieldEscape(h.selectedText);
    const back = h.annotation?.noteText
      ? ankiFieldEscape(h.annotation.noteText)
      : ankiFieldEscape(`From: ${article?.title ?? "Untitled"}`);
    if (!front) continue;
    lines.push(`${front}\t${back}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `booklet-anki-export-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportRow {
  url: string;
  title: string | null;
}

/** Lenient CSV parser: handles quoted fields (with escaped "" and embedded
 * commas/newlines), which real-world Pocket/Instapaper exports use for
 * titles containing commas. Not a full RFC 4180 implementation, but covers
 * what these two actually produce. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function parseImportCsv(text: string): ImportRow[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const urlIndex = header.findIndex((h) => h === "url" || h === "link");
  const titleIndex = header.findIndex((h) => h === "title" || h === "name");
  if (urlIndex === -1) return [];

  return rows
    .slice(1)
    .map((r) => ({ url: (r[urlIndex] ?? "").trim(), title: titleIndex >= 0 ? (r[titleIndex] ?? "").trim() || null : null }))
    .filter((r) => {
      try {
        new URL(r.url);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * Netscape bookmark file format -- what Chrome/Firefox/Safari/Edge all
 * produce from "Export bookmarks". Every browser's export nests folders
 * differently, but every real bookmark is always an <a href> somewhere in
 * the tree, so a flat query sidesteps parsing the folder structure at all.
 */
export function parseBookmarksHtml(html: string): ImportRow[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows: ImportRow[] = [];
  for (const a of doc.querySelectorAll("a[href]")) {
    const url = a.getAttribute("href")?.trim() ?? "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    rows.push({ url, title: a.textContent?.trim() || null });
  }
  return rows;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

export async function importUrls(
  rows: ImportRow[],
  authenticated: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < rows.length; i++) {
    try {
      await saveArticleFromUrl(rows[i].url, authenticated);
      result.imported++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) result.skipped++;
      else result.failed++;
    }
    onProgress?.(i + 1, rows.length);
  }
  return result;
}

export interface KindleImportResult {
  booksImported: number;
  highlightsImported: number;
}

/**
 * Imports a Kindle "My Clippings.txt" export -- one Article per book
 * (get-or-create, so re-importing the same file is safe: existing books
 * aren't duplicated, and this doesn't attempt to detect/skip individual
 * already-imported highlights within a book, so re-importing does create
 * duplicate highlights for a book you'd previously imported). Each book
 * has no url and no extractable content of its own (there's nothing to
 * extract -- it's a physical/Kindle-native book, not a saved web page or
 * uploaded file), just the highlights/notes recovered from the file.
 */
export async function importKindleClippings(
  text: string,
  authenticated: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<KindleImportResult> {
  const books = parseKindleClippings(text);
  const totalEntries = books.reduce((sum, b) => sum + b.entries.length, 0);
  let done = 0;

  let highlightsImported = 0;
  for (const book of books) {
    const article = await getOrCreateBookArticle(book.title, book.author, authenticated);
    for (const entry of book.entries) {
      await createHighlight(
        {
          articleId: article.id,
          selectedText: entry.text,
          position: { type: "text", exact: entry.text, prefix: "", suffix: "", start: 0, end: entry.text.length },
          color: KINDLE_HIGHLIGHT_COLOR,
        },
        authenticated,
      );
      highlightsImported++;
      done++;
      onProgress?.(done, totalEntries);
    }
  }

  return { booksImported: books.length, highlightsImported };
}
