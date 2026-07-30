/**
 * The local-vs-synced swap point for articles -- mirrors the web app's
 * lib/data/articles.ts. Screens call these with the current auth state
 * instead of talking to lib/local/db.ts or lib/api.ts directly.
 */
import type { Article, ArticleListResponse, ExtractedContent } from "@booklet/shared";
import { apiFetch, ApiError } from "../api";
import { generateLocalId, localArticles, localHighlights } from "../local/db";

export { ApiError };

async function extractContent(url: string): Promise<ExtractedContent> {
  return apiFetch<ExtractedContent>("/api/extract", { method: "POST", body: JSON.stringify({ url }), auth: false });
}

export async function loadArticles(authenticated: boolean): Promise<Article[]> {
  if (!authenticated) return localArticles.getAll();

  const articles: Article[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: ArticleListResponse = await apiFetch<ArticleListResponse>(`/api/articles?${query}`);
    articles.push(...(res.articles as Article[]));
    cursor = res.nextCursor;
    hasMore = cursor !== null;
  }
  return articles;
}

export async function loadArticle(id: string, authenticated: boolean): Promise<Article | null> {
  if (!authenticated) return (await localArticles.get(id)) ?? null;
  try {
    return await apiFetch<Article>(`/api/articles/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveArticleFromUrl(url: string, authenticated: boolean): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>("/api/articles", { method: "POST", body: JSON.stringify({ url }) });
  }

  const existing = (await localArticles.getAll()).find((a) => a.url === url);
  if (existing) throw new ApiError(409, "already_saved", "You've already saved this article.");

  let extracted: ExtractedContent | null = null;
  let extractionError: string | null = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    extractionError = err instanceof ApiError ? err.message : "Extraction failed.";
  }

  const now = new Date().toISOString();
  const article: Article = {
    id: generateLocalId(),
    userId: "local",
    url,
    canonicalUrl: null,
    title: extracted?.title ?? null,
    author: extracted?.author ?? null,
    siteName: extracted?.siteName ?? null,
    excerpt: extracted?.excerpt ?? null,
    sourceType: "HTML",
    extractionStatus: extracted ? "SUCCESS" : "FAILED",
    extractionError,
    extractedHtml: extracted?.html ?? null,
    extractedText: extracted?.text ?? null,
    textSource: null,
    fileStorageKey: null,
    originalFilename: null,
    readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
    progressFraction: 0,
    activeReadingSeconds: 0,
    tags: [],
    status: "UNREAD",
    savedAt: now,
    readAt: null,
    archivedAt: null,
    favorited: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await localArticles.put(article);
  return article;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  // expo-document-picker only sets this on its web implementation ("File
  // object for parity with web File API, @platform web" per its own
  // types). Real native (iOS/Android) React Native's FormData accepts a
  // {uri, name, type} object and streams directly from the picked file's
  // on-device URI instead -- the bytes never need to be read into JS
  // memory first, unlike web's Blob-based FormData. Confirmed by hand
  // that using the {uri, name, type} form on the *web* target sends a
  // malformed/empty part (a plain object isn't a valid FormData value in
  // a real browser's fetch) -- webFile is the fix, not a style choice.
  webFile?: File;
}

// {uri, name, type} isn't representable in the DOM-derived FormData types
// TypeScript uses here, so this needs a cast; it's the standard,
// correct-at-runtime RN pattern for the native (non-web) case.
function fileFormPart(file: PickedFile, type: string): Blob {
  if (file.webFile) return file.webFile;
  return { uri: file.uri, name: file.name, type } as unknown as Blob;
}

// No local raw-file store on mobile (unlike the web app's localFiles) --
// there's no real PDF/EPUB renderer here to feed it to and no
// download-to-device-storage link in this scaffold, only the extracted
// text (reusing the same highlighting ArticleScreen already has for HTML).
// The picked file's bytes go straight to the stateless extraction
// endpoint and are then discarded.
export async function saveArticleFromFile(file: PickedFile, authenticated: boolean): Promise<Article> {
  const fileName = file.name;
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext !== "pdf" && ext !== "epub") {
    throw new ApiError(400, "unsupported_type", "Only .pdf and .epub files are supported.");
  }
  const type = file.mimeType ?? (ext === "pdf" ? "application/pdf" : "application/epub+zip");

  if (authenticated) {
    const form = new FormData();
    form.append("file", fileFormPart(file, type), fileName);
    return apiFetch<Article>("/api/articles/upload", { method: "POST", body: form });
  }

  let extracted: ExtractedContent | null = null;
  let extractionError: string | null = null;
  try {
    const form = new FormData();
    form.append("file", fileFormPart(file, type), fileName);
    extracted = await apiFetch<ExtractedContent>("/api/extract-file", { method: "POST", body: form, auth: false });
  } catch (err) {
    extractionError = err instanceof ApiError ? err.message : "Extraction failed.";
  }

  const now = new Date().toISOString();
  const article: Article = {
    id: generateLocalId(),
    userId: "local",
    url: null,
    canonicalUrl: null,
    title: extracted?.title ?? fileName.replace(/\.(pdf|epub)$/i, ""),
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: ext === "pdf" ? "PDF" : "EPUB",
    extractionStatus: extracted ? "SUCCESS" : "FAILED",
    extractionError,
    extractedHtml: null,
    extractedText: extracted?.text ?? null,
    textSource: null,
    fileStorageKey: null,
    originalFilename: fileName,
    readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
    progressFraction: 0,
    activeReadingSeconds: 0,
    tags: [],
    status: "UNREAD",
    savedAt: now,
    readAt: null,
    archivedAt: null,
    favorited: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await localArticles.put(article);
  return article;
}

export async function deleteArticle(id: string, authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/articles/${id}`, { method: "DELETE" });
    return;
  }
  await localArticles.delete(id);
  const highlights = await localHighlights.getForArticle(id);
  await Promise.all(highlights.map((h) => localHighlights.delete(h.id)));
}
