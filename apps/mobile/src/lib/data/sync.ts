/**
 * Migrates whatever's currently in local AsyncStorage into the
 * just-authenticated account, then clears it. Mirrors the web app's
 * lib/data/sync.ts against the same POST /api/sync/import endpoint --
 * mobile just never has collections to send, since there's no collections
 * UI here yet.
 */
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "../api";
import { localArticles, localHighlights } from "../local/db";

const EMPTY_RESULT: ImportResponse = {
  importedArticles: 0,
  skippedArticles: 0,
  importedHighlights: 0,
  importedCollections: 0,
  skippedCollections: 0,
};

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  const [articles, highlights] = await Promise.all([localArticles.getAll(), localHighlights.getAll()]);
  if (articles.length === 0 && highlights.length === 0) return EMPTY_RESULT;

  const body: ImportRequest = {
    articles: articles.map((a) => ({
      localId: a.id,
      url: a.url,
      title: a.title,
      author: a.author,
      siteName: a.siteName,
      excerpt: a.excerpt,
      sourceType: a.sourceType,
      extractionStatus: a.extractionStatus,
      extractionError: a.extractionError,
      extractedHtml: a.extractedHtml,
      extractedText: a.extractedText,
      readingTimeEstimate: a.readingTimeEstimate,
      progressFraction: a.progressFraction,
      status: a.status,
      savedAt: a.savedAt,
      readAt: a.readAt,
      archivedAt: a.archivedAt,
    })),
    highlights: highlights.map((h) => ({
      localArticleId: h.articleId,
      selectedText: h.selectedText,
      position: h.position,
      color: h.color,
      lastSurfacedAt: h.lastSurfacedAt,
      surfaceCount: h.surfaceCount,
      lastFeedback: h.lastFeedback,
      lastFeedbackAt: h.lastFeedbackAt,
      resurfaceArchivedAt: h.resurfaceArchivedAt,
      createdAt: h.createdAt,
      noteText: h.annotation?.noteText ?? null,
    })),
    collections: [],
    articleCollections: [],
  };

  const result = await apiFetch<ImportResponse>("/api/sync/import", {
    method: "POST",
    body: JSON.stringify(body),
  });

  await Promise.all([localArticles.clear(), localHighlights.clear()]);
  return result;
}
