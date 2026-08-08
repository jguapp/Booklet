/**
 * Migrates whatever's currently in local AsyncStorage into the
 * just-authenticated account, then clears it. Mirrors the web app's
 * lib/data/sync.ts against the same POST /api/sync/import endpoint.
 */
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "../api";
import { localArticleCollections, localArticles, localCollections, localHighlights } from "../local/db";

const EMPTY_RESULT: ImportResponse = {
  importedArticles: 0,
  skippedArticles: 0,
  importedHighlights: 0,
  importedCollections: 0,
  skippedCollections: 0,
  // Present for the type, unused here: the second phase the web client runs
  // with this map (#172) uploads PDF/EPUB bytes out of IndexedDB, and this
  // app has no local file store to migrate from -- uploads are web-only.
  localIdToServerId: {},
};

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  const [articles, highlights, collections] = await Promise.all([
    localArticles.getAll(),
    localHighlights.getAll(),
    localCollections.getAll(),
  ]);
  if (articles.length === 0 && highlights.length === 0 && collections.length === 0) return EMPTY_RESULT;

  const articleCollections = (
    await Promise.all(collections.map((c) => localArticleCollections.getForCollection(c.id)))
  ).flat();

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
      activeReadingSeconds: a.activeReadingSeconds,
      tags: a.tags,
      status: a.status,
      savedAt: a.savedAt,
      readAt: a.readAt,
      archivedAt: a.archivedAt,
      favorited: a.favorited,
    })),
    highlights: highlights.map((h) => ({
      localArticleId: h.articleId,
      selectedText: h.selectedText,
      position: h.position,
      color: h.color,
      prompt: h.prompt,
      lastSurfacedAt: h.lastSurfacedAt,
      surfaceCount: h.surfaceCount,
      lastFeedback: h.lastFeedback,
      lastFeedbackAt: h.lastFeedbackAt,
      resurfaceArchivedAt: h.resurfaceArchivedAt,
      createdAt: h.createdAt,
      noteText: h.annotation?.noteText ?? null,
      // The review schedule built up while reading anonymously (#171).
      // Without these, signing up silently resets every highlight to
      // "never reviewed, due now".
      easinessFactor: h.easinessFactor,
      intervalDays: h.intervalDays,
      repetitions: h.repetitions,
      nextDueAt: h.nextDueAt,
    })),
    collections: collections.map((c) => ({ localId: c.id, name: c.name, color: c.color })),
    articleCollections: articleCollections.map((l) => ({
      localArticleId: l.articleId,
      localCollectionId: l.collectionId,
    })),
  };

  const result = await apiFetch<ImportResponse>("/api/sync/import", {
    method: "POST",
    body: JSON.stringify(body),
  });

  await Promise.all([
    localArticles.clear(),
    localHighlights.clear(),
    localCollections.clear(),
    localArticleCollections.clear(),
  ]);
  return result;
}
