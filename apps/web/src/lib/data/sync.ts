/**
 * Migrates whatever's currently in local IndexedDB into the just-authenticated
 * account, then clears it -- the server becomes the source of truth for this
 * browser going forward. Runs on every successful login/signup (not just
 * once ever): local storage is normally empty after the first migration, and
 * only has content again if someone used anonymous mode in between sessions.
 */
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { localArticles, localHighlights } from "@/lib/local/db";

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  const [articles, highlights] = await Promise.all([localArticles.getAll(), localHighlights.getAll()]);

  if (articles.length === 0 && highlights.length === 0) {
    return { importedArticles: 0, skippedArticles: 0, importedHighlights: 0 };
  }

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
  };

  const result = await apiFetch<ImportResponse>("/api/sync/import", {
    method: "POST",
    body: JSON.stringify(body),
  });

  await Promise.all([localArticles.clear(), localHighlights.clear()]);

  return result;
}
