import type { ArticleStatus, ExtractionStatus, SourceType } from "./article";
import type { HighlightColor, ResurfaceFeedback } from "./highlight";
import type { HighlightPosition } from "./highlight-position";

/**
 * POST /api/sync/import -- one-shot migration of a browser's local
 * (IndexedDB, no-account) library into a newly-authenticated account.
 * Accounts are optional and exist only for sync, so this is what actually
 * makes "sync" true rather than a promise that silently drops your data
 * the moment you sign up.
 */
export interface ImportArticle {
  localId: string;
  url: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  sourceType: SourceType;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  extractedHtml: string | null;
  extractedText: string | null;
  readingTimeEstimate: number | null;
  progressFraction: number;
  activeReadingSeconds: number;
  tags: string[];
  status: ArticleStatus;
  savedAt: string;
  readAt: string | null;
  archivedAt: string | null;
  favorited: boolean;
}

export interface ImportHighlight {
  localArticleId: string;
  selectedText: string;
  position: HighlightPosition;
  color: HighlightColor;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  lastFeedback: ResurfaceFeedback | null;
  lastFeedbackAt: string | null;
  resurfaceArchivedAt: string | null;
  createdAt: string;
  noteText: string | null;
}

export interface ImportCollection {
  localId: string;
  name: string;
  color: string | null;
}

export interface ImportArticleCollection {
  localArticleId: string;
  localCollectionId: string;
}

export interface ImportRequest {
  articles: ImportArticle[];
  highlights: ImportHighlight[];
  collections: ImportCollection[];
  articleCollections: ImportArticleCollection[];
}

export interface ImportResponse {
  importedArticles: number;
  skippedArticles: number; // already existed server-side (same URL) -- highlights still attach to those
  importedHighlights: number;
  importedCollections: number;
  skippedCollections: number; // already existed server-side (same name)
}
