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
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api/client";
import { localArticles, localFiles } from "@/lib/local/db";

export { ApiError };

/** Raw PDF/EPUB bytes for the real (page/CFI) readers -- local file from IndexedDB, or the auth-gated download route. */
export async function loadArticleFile(articleId: string, authenticated: boolean): Promise<Blob | null> {
  if (!authenticated) {
    const file = await localFiles.get(articleId);
    return file?.blob ?? null;
  }
  try {
    return await apiFetchBlob(`/api/articles/${articleId}/file`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
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

  const existing = (await localArticles.getAll()).find((a) => a.url === url);
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
    title: extracted?.title ?? null,
    author: extracted?.author ?? null,
    siteName: extracted?.siteName ?? null,
    excerpt: extracted?.excerpt ?? null,
    sourceType: "HTML",
    extractionStatus: extracted ? "SUCCESS" : "FAILED",
    extractionError,
    extractedHtml: extracted?.html ?? null,
    extractedText: extracted?.text ?? null,
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
    title: extracted?.title ?? file.name.replace(/\.(pdf|epub)$/i, ""),
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: ext === "pdf" ? "PDF" : "EPUB",
    extractionStatus: extracted ? "SUCCESS" : "FAILED",
    extractionError,
    extractedHtml: null,
    extractedText: extracted?.text ?? null,
    fileStorageKey: id, // local files are keyed by article id, see lib/local/db localFiles
    originalFilename: file.name,
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
  await localFiles.put(id, file);
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
