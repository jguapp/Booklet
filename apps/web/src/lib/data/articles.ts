/**
 * The local-vs-synced swap point for articles. Every page calls these
 * functions with the caller's current auth state instead of talking to
 * lib/local/db.ts or lib/api/client.ts directly -- callers wait for
 * useAuth().status to leave "loading" first so this never guesses.
 */
import type {
  Article,
  ArticleListResponse,
  ArticleStatus,
  ExtractedContent,
} from "@booklet/shared";
import { canonicalizeUrl } from "@booklet/shared";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api/client";
import { localArticles, localFiles } from "@/lib/local/db";
import { pendingFileUploadFor } from "@/lib/data/sync";

export { ApiError };

// Authenticated mode has no local copy to read from (unlike the IndexedDB
// path below), so without this every reader open -- including reopening the
// same article -- re-downloads the whole original file over the network.
// fileStorageKey is set once at upload and never replaced in place (see the
// matching Cache-Control header on the route itself), so caching by
// articleId for the lifetime of the tab is safe.
const fileCache = new Map<string, Blob>();

/** Raw PDF/EPUB bytes for the real (page/CFI) readers -- local file from IndexedDB, or the auth-gated download route. */
export async function loadArticleFile(articleId: string, authenticated: boolean): Promise<Blob | null> {
  if (!authenticated) {
    const file = await localFiles.get(articleId);
    return file?.blob ?? null;
  }
  const cached = fileCache.get(articleId);
  if (cached) return cached;
  try {
    const blob = await apiFetchBlob(`/api/articles/${articleId}/file`);
    fileCache.set(articleId, blob);
    return blob;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // A 404 here is "this article has no file on the server" -- which is
      // also true of a PDF or EPUB whose row has migrated but whose bytes
      // are still being uploaded (#172). Migration is not instant and a
      // shelf of EPUBs takes a while, so without this the book someone
      // opens during that window is an empty reader, indistinguishable from
      // the bug this fallback exists because of. The copy is still on disk;
      // the registry is what remembers which local id it is under, since the
      // local article row is already gone. Not cached -- the server's copy
      // takes over the moment the upload lands.
      const pending = pendingFileUploadFor(articleId);
      if (pending) return (await localFiles.get(pending.localArticleId))?.blob ?? null;
      return null;
    }
    throw err;
  }
}

async function extractContent(url: string): Promise<ExtractedContent> {
  return apiFetch<ExtractedContent>("/api/extract", {
    method: "POST",
    body: JSON.stringify({ url }),
    auth: false,
  });
}

async function extractFileContent(file: File): Promise<ExtractedContent> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiFetch<ExtractedContent>("/api/extract-file", { method: "POST", body: form, auth: false });
}

export async function loadArticles(authenticated: boolean): Promise<Article[]> {
  if (!authenticated) return localArticles.getAll();

  const articles: Article[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
    const res: ArticleListResponse = await apiFetch<ArticleListResponse>(`/api/articles?${params}`);
    articles.push(...(res.articles as Article[])); // summary omits extractedHtml/Text, both absent (not undefined) here
    cursor = res.nextCursor;
  } while (cursor);
  return articles;
}

/** How many full-article fetches loadArticlesWithText keeps in flight. Enough
 * that a library of a few hundred doesn't crawl, low enough that pressing
 * Export doesn't look like a burst of abuse to the API's rate limiter. */
const FULL_TEXT_CONCURRENCY = 4;

/**
 * Every article *including* its body text -- which loadArticles above does
 * not give you when signed in, however much its `Article[]` return type
 * suggests otherwise: the list endpoint answers with summaries, and
 * `extractedText` is absent (not empty) on every row.
 *
 * That difference had teeth. The Markdown export walks this list and writes
 * `article.extractedText` into each file, so signed out it exported whole
 * articles and signed in it exported frontmatter and highlights with the
 * article itself missing -- the same one-branch-only shape as #164/#171/#172,
 * and silent, because a .zip full of valid-looking Markdown files is exactly
 * what you'd expect to see either way.
 *
 * Local mode needs none of this: IndexedDB stores whole Article rows, so the
 * list is already complete and this returns it untouched.
 *
 * An article whose own fetch fails keeps its summary rather than sinking the
 * export -- one unreachable article should cost that article's body, not the
 * other four hundred.
 */
export async function loadArticlesWithText(authenticated: boolean): Promise<Article[]> {
  const articles = await loadArticles(authenticated);
  if (!authenticated) return articles;

  const full = [...articles];
  let next = 0;
  async function worker() {
    while (next < full.length) {
      const index = next++;
      try {
        const detailed = await loadArticle(full[index].id, true);
        if (detailed) full[index] = detailed;
      } catch {
        // Keeps the summary -- see the note above.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FULL_TEXT_CONCURRENCY, full.length) }, worker));
  return full;
}

/** Trash, not the regular library -- excluded from loadArticles() above
 * regardless of status, same on both the local and server sides. */
export async function loadTrash(authenticated: boolean): Promise<Article[]> {
  if (!authenticated) return localArticles.getTrash();

  const articles: Article[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "100", trashed: "true", ...(cursor ? { cursor } : {}) });
    const res: ArticleListResponse = await apiFetch<ArticleListResponse>(`/api/articles?${params}`);
    articles.push(...(res.articles as Article[]));
    cursor = res.nextCursor;
  } while (cursor);
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

  const canonicalUrl = canonicalizeUrl(url);
  const existing = (await localArticles.getAll()).find(
    (a) => a.url === url || (canonicalUrl && a.canonicalUrl === canonicalUrl),
  );
  if (existing) {
    throw new ApiError(409, "already_saved", "You've already saved this article.");
  }

  let extracted: ExtractedContent | null = null;
  let extractionError: string | null = null;
  try {
    extracted = await extractContent(url);
  } catch (err) {
    extractionError = err instanceof ApiError ? err.message : "Extraction failed.";
  }

  const now = new Date().toISOString();
  const article: Article = {
    id: crypto.randomUUID(),
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
    // Null, not 0 -- a brand new article has never been listened to, which is
    // a different thing from "listened to, and paused at the start". Only the
    // latter is worth offering to resume from.
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

export async function saveArticleFromFile(file: File, authenticated: boolean): Promise<Article> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext !== "pdf" && ext !== "epub") {
    throw new ApiError(400, "unsupported_type", "Only .pdf and .epub files are supported.");
  }

  if (authenticated) {
    const form = new FormData();
    form.append("file", file, file.name);
    return apiFetch<Article>("/api/articles/upload", { method: "POST", body: form });
  }

  let extracted: ExtractedContent | null = null;
  let extractionError: string | null = null;
  try {
    extracted = await extractFileContent(file);
  } catch (err) {
    extractionError = err instanceof ApiError ? err.message : "Extraction failed.";
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const article: Article = {
    id,
    userId: "local",
    url: null,
    canonicalUrl: null,
    title: extracted?.title ?? file.name.replace(/\.(pdf|epub)$/i, ""),
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: ext === "pdf" ? "PDF" : "EPUB",
    extractionStatus: extracted ? "SUCCESS" : "FAILED",
    extractionError,
    extractedHtml: null,
    extractedText: extracted?.text ?? null,
    textSource: extracted?.textSource ?? null,
    fileStorageKey: id, // local files are keyed by article id, see lib/local/db localFiles
    originalFilename: file.name,
    coverImageUrl: extracted?.coverImageUrl ?? null,
    readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
    skippedImageCount: 0, // PDF/EPUB extraction doesn't inline images at all
    progressFraction: 0,
    activeReadingSeconds: 0,
    // Null, not 0 -- a brand new article has never been listened to, which is
    // a different thing from "listened to, and paused at the start". Only the
    // latter is worth offering to resume from.
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
  await localFiles.put(id, file);
  return article;
}

/** Get-or-create a title/author-only "book" article -- no url, no file.
 * Only real producer today is the Kindle My Clippings.txt importer
 * (export-import.ts), where all that exists for a given book is its
 * highlights, not the book's own content. */
export async function getOrCreateBookArticle(
  title: string,
  author: string | null,
  authenticated: boolean,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>("/api/articles/book", { method: "POST", body: JSON.stringify({ title, author }) });
  }

  const existing = (await localArticles.getAll()).find(
    (a) => a.sourceType === "BOOK" && a.title === title && a.author === author,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const article: Article = {
    id: crypto.randomUUID(),
    userId: "local",
    url: null,
    canonicalUrl: null,
    title,
    author,
    siteName: null,
    excerpt: null,
    sourceType: "BOOK",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText: null,
    textSource: null,
    fileStorageKey: null,
    originalFilename: null,
    coverImageUrl: null,
    readingTimeEstimate: null,
    skippedImageCount: 0,
    progressFraction: 0,
    activeReadingSeconds: 0,
    // Null, not 0 -- a brand new article has never been listened to, which is
    // a different thing from "listened to, and paused at the start". Only the
    // latter is worth offering to resume from.
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

export async function updateArticleStatus(
  article: Article,
  status: ArticleStatus,
  authenticated: boolean,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
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

export async function updateArticleProgress(
  article: Article,
  progressFraction: number,
  authenticated: boolean,
  activeReadingSecondsDelta = 0,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        progressFraction,
        ...(activeReadingSecondsDelta > 0 ? { activeReadingSecondsDelta } : {}),
      }),
    });
  }
  const updated: Article = {
    ...article,
    progressFraction,
    activeReadingSeconds: article.activeReadingSeconds + activeReadingSecondsDelta,
    updatedAt: new Date().toISOString(),
  };
  await localArticles.put(updated);
  return updated;
}

/**
 * Persists the read-aloud position (#152), the listening sibling of
 * updateArticleProgress above and deliberately shaped the same way.
 *
 * Called on the player's periodic flush, not on every `timeupdate` -- a chunk
 * fires those several times a second, and a network request per tick would
 * cost more than the feature is worth.
 *
 * Last-write-wins. Two devices playing one article simultaneously is rare, and
 * there's no reconciliation of two positions that is more correct than "the
 * most recent one" -- see UpdateArticleRequest.
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
  // Takes an id rather than an Article because the only caller is the global
  // player (tts-player-provider.tsx), which is mounted in the root layout and
  // deliberately knows nothing but which article is playing -- playback
  // outlives the reader page that has the record in hand. One indexed read per
  // flush, on a multi-second cadence, is not worth restructuring that for.
  const article = await localArticles.get(articleId);
  // Gone from local storage mid-playback (deleted in another tab) -- there is
  // nothing to write a position onto, and recreating the row would resurrect
  // a deleted article.
  if (!article) return null;
  // Local mode still records it: the position survives a reload on this
  // device, which is most of the value even with nothing to sync to. The
  // device id is stored too, so the resume prompt's "on another device" check
  // is one code path rather than two.
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

export async function updateArticleTags(article: Article, tags: string[], authenticated: boolean): Promise<Article> {
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tags: cleaned }),
    });
  }
  const updated: Article = { ...article, tags: cleaned, updatedAt: new Date().toISOString() };
  await localArticles.put(updated);
  return updated;
}

/** Renames an article. Really replaces the title (there's no separate
 * "original" kept around to fall back to) -- same as every other field
 * here, it works signed out against the local store too. */
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

export async function updateArticleFavorited(
  article: Article,
  favorited: boolean,
  authenticated: boolean,
): Promise<Article> {
  if (authenticated) {
    return apiFetch<Article>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ favorited }),
    });
  }
  const updated: Article = { ...article, favorited, updatedAt: new Date().toISOString() };
  await localArticles.put(updated);
  return updated;
}

/** The everyday "delete" action -- moves it to Trash instead of removing it
 * outright, so it's recoverable for 30 days. See permanentlyDeleteArticle
 * for the irreversible one (used by the Trash page). */
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

/** Same as trashArticle, but for callers (drag-and-drop onto the Trash nav
 * link) that only have an id, not the full Article -- the local path needs
 * to look the record up first to preserve its other fields when writing it
 * back, since IndexedDB has no partial-update primitive. */
export async function trashArticleById(id: string, authenticated: boolean): Promise<void> {
  const now = new Date().toISOString();
  if (authenticated) {
    await apiFetch<Article>(`/api/articles/${id}`, { method: "PATCH", body: JSON.stringify({ deletedAt: now }) });
    return;
  }
  const existing = await localArticles.get(id);
  if (!existing) return;
  await localArticles.put({ ...existing, deletedAt: now, updatedAt: now });
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
  await Promise.all([localArticles.delete(id), localFiles.delete(id)]);
}

export async function emptyTrash(authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch("/api/articles/trash", { method: "DELETE" });
    return;
  }
  const trashed = await localArticles.getTrash();
  await Promise.all(trashed.map((a) => Promise.all([localArticles.delete(a.id), localFiles.delete(a.id)])));
}

/** Authenticated-account-only, like the Developer settings (tokens/
 * webhooks) -- this needs a real server to send the email from, so
 * there's no local/anonymous-mode equivalent to branch to. */
export async function sendArticleToKindle(articleId: string): Promise<void> {
  await apiFetch(`/api/articles/${articleId}/send-to-kindle`, { method: "POST" });
}
