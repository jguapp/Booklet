/**
 * The local-vs-synced swap point for articles -- mirrors the web app's
 * lib/data/articles.ts. Screens call these with the current auth state
 * instead of talking to lib/local/db.ts or lib/api.ts directly.
 */
import type { Article, ArticleListResponse, ArticleStatus, ExtractedContent } from "@booklet/shared";
import { canonicalizeUrl } from "@booklet/shared";
import { apiFetch, ApiError } from "../api";
import { generateLocalId, localArticles } from "../local/db";

export { ApiError };

async function extractContent(url: string): Promise<ExtractedContent> {
  return apiFetch<ExtractedContent>("/api/extract", { method: "POST", body: JSON.stringify({ url }), auth: false });
}

/**
 * Still narrower than the web app's articles.ts -- no tags, reading
 * progress or send-to-Kindle, since mobile has no screen that needs them
 * yet -- but the everyday library actions now have counterparts here:
 * favorite, status, rename, and the whole trash lifecycle
 * (trash / restore / permanentlyDelete / emptyTrash / loadTrash). The trash
 * filter the older comment warned about landed with them, in
 * lib/local/db.ts's localArticles.getAll(); a soft-deleted local article no
 * longer comes back into the library list.
 */
export async function loadArticles(authenticated: boolean): Promise<Article[]> {
  if (!authenticated) return localArticles.getAll();

  const articles: Article[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: ArticleListResponse = await apiFetch<ArticleListResponse>(`/api/articles?${query}`);
    // summary omits extractedHtml/extractedText, both absent (not undefined)
    // here -- ArticleScreen re-fetches the full row via loadArticle().
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

/** The soft-deleted articles -- the Trash screen's source. Signed in, the
 * list route returns them under `?trashed=true`; locally they're the
 * complement of loadArticles (see localArticles.getTrash). */
export async function loadTrash(authenticated: boolean): Promise<Article[]> {
  if (!authenticated) return localArticles.getTrash();

  const articles: Article[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const query = `limit=100&trashed=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res: ArticleListResponse = await apiFetch<ArticleListResponse>(`/api/articles?${query}`);
    articles.push(...(res.articles as Article[]));
    cursor = res.nextCursor;
    hasMore = cursor !== null;
  }
  return articles;
}

// Every write below follows the same shape as the web app's articles.ts: a
// PATCH when signed in, a read-modify-put against the local store when not.
// AsyncStorage has no partial-update primitive, so the local branch always
// writes the whole record back -- which is why these take the full Article
// rather than an id (except the two that only ever have an id in hand).

export async function updateArticleStatus(
  article: Article,
  status: ArticleStatus,
  authenticated: boolean,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  const now = new Date().toISOString();
  const updated: Article = {
    ...article,
    status,
    readAt: status === "READING" && !article.readAt ? now : article.readAt,
    archivedAt: status === "ARCHIVED" ? (article.archivedAt ?? now) : status === "UNREAD" ? null : article.archivedAt,
    updatedAt: now,
  };
  await localArticles.put(updated);
  return updated;
}

export async function updateArticleFavorited(
  article: Article,
  favorited: boolean,
  authenticated: boolean,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, { method: "PATCH", body: JSON.stringify({ favorited }) });
  }
  const updated: Article = { ...article, favorited, updatedAt: new Date().toISOString() };
  await localArticles.put(updated);
  return updated;
}

/** Replaces the title -- there's no separate "original" kept to fall back to,
 * same as the web app. */
export async function renameArticle(article: Article, title: string, authenticated: boolean): Promise<Article> {
  const cleaned = title.trim();
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: cleaned }),
    });
  }
  const updated: Article = { ...article, title: cleaned, updatedAt: new Date().toISOString() };
  await localArticles.put(updated);
  return updated;
}

/** The everyday "delete": moves the article to Trash (a soft delete via
 * `deletedAt`), recoverable for 30 days. permanentlyDeleteArticle is the
 * irreversible one the Trash screen uses. */
export async function trashArticle(article: Article, authenticated: boolean): Promise<Article> {
  const now = new Date().toISOString();
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ deletedAt: now }),
    });
  }
  const updated: Article = { ...article, deletedAt: now, updatedAt: now };
  await localArticles.put(updated);
  return updated;
}

export async function restoreArticle(article: Article, authenticated: boolean): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ deletedAt: null }),
    });
  }
  const updated: Article = { ...article, deletedAt: null, updatedAt: new Date().toISOString() };
  await localArticles.put(updated);
  return updated;
}

export async function permanentlyDeleteArticle(id: string, authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/articles/${id}`, { method: "DELETE" });
    return;
  }
  await localArticles.delete(id);
}

export async function emptyTrash(authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch("/api/articles/trash", { method: "DELETE" });
    return;
  }
  // A batched deleteMany, not one delete() per row -- concurrent single-id
  // deletes race the shared JSON map (see localArticles.deleteMany's note).
  const trashed = await localArticles.getTrash();
  await localArticles.deleteMany(trashed.map((a) => a.id));
}

/**
 * Where the read-aloud player is in an article, 0..1 -- mirrors the web
 * app's updateArticleListeningPosition, same last-write-wins reasoning (see
 * UpdateArticleRequest). Called on chunk boundaries and pauses, not every
 * playback tick. Local mode still records it: the position survives a
 * reload on this device, which is most of the value even with nothing to
 * sync to.
 */
export async function updateArticleListeningPosition(
  articleId: string,
  listeningFraction: number,
  deviceId: string,
  authenticated: boolean,
): Promise<Article | null> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${articleId}`, {
      method: "PATCH",
      body: JSON.stringify({ listeningFraction, listeningDeviceId: deviceId }),
    });
  }
  const article = await localArticles.get(articleId);
  // Gone from local storage mid-playback -- recreating the row would
  // resurrect a deleted article.
  if (!article) return null;
  const now = new Date().toISOString();
  const updated: Article = {
    ...article,
    listeningFraction,
    listeningUpdatedAt: now,
    listeningDeviceId: deviceId,
    updatedAt: now,
  };
  await localArticles.put(updated);
  return updated;
}

export async function saveArticleFromUrl(url: string, authenticated: boolean): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>("/api/articles", { method: "POST", body: JSON.stringify({ url }) });
  }

  // Matched on the canonical form as well as the raw one, the same as the
  // web app and the same as the server's own duplicate check. Exact-string
  // matching alone misses the everyday cases -- the utm_-decorated share
  // link, the AMP variant, a trailing slash -- so saving the same article
  // twice from two different places silently produced two library entries
  // with two separate sets of highlights.
  const canonicalUrl = canonicalizeUrl(url);
  const existing = (await localArticles.getAll()).find(
    (a) => a.url === url || (canonicalUrl !== null && a.canonicalUrl === canonicalUrl),
  );
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
    canonicalUrl,
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
    coverImageUrl: extracted?.coverImageUrl ?? null,
    readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
    skippedImageCount: extracted?.skippedImageCount ?? 0,
    progressFraction: 0,
    activeReadingSeconds: 0,
    // Null rather than 0 -- never listened is distinct from paused at the
    // start (#152). Read-aloud only ever writes a position through
    // updateArticleListeningPosition once playback has actually started.
    listeningFraction: null,
    listeningUpdatedAt: null,
    listeningDeviceId: null,
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
    // Carried through, not hardcoded null: "OCR" is the only signal that this
    // text came out of image recognition and can therefore contain errors a
    // native text layer never would. Dropping it made a scanned PDF
    // indistinguishable from a clean one, on the one device where the reader
    // shows nothing but that text.
    textSource: extracted?.textSource ?? null,
    fileStorageKey: null,
    originalFilename: fileName,
    coverImageUrl: extracted?.coverImageUrl ?? null,
    readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
    skippedImageCount: 0, // PDF/EPUB extraction doesn't inline images at all
    progressFraction: 0,
    activeReadingSeconds: 0,
    // Null rather than 0 -- never listened is distinct from paused at the
    // start (#152). Read-aloud only ever writes a position through
    // updateArticleListeningPosition once playback has actually started.
    listeningFraction: null,
    listeningUpdatedAt: null,
    listeningDeviceId: null,
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
