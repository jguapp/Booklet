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
    status: "UNREAD",
    savedAt: now,
    readAt: null,
    archivedAt: null,
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
