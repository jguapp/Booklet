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
  /** Hand-written and unrecoverable if dropped, so it has to survive the
   * anonymous -> signed-up crossing -- that class of silent loss is what
   * #164 was. */
  prompt: string | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  lastFeedback: ResurfaceFeedback | null;
  lastFeedbackAt: string | null;
  resurfaceArchivedAt: string | null;
  createdAt: string;
  noteText: string | null;

  /**
   * SM-2 scheduling state (#171). These were missing until they were looked
   * for: five adjacent resurfacing fields were present, which made the four
   * absent ones read as a decision rather than an oversight. They were not.
   * A highlight reviewed four times to a 16-day interval arrived with
   * repetitions 0 and nextDueAt null -- due immediately -- while
   * surfaceCount and lastFeedback survived and went on claiming it had been
   * reviewed, so the library and the scheduler disagreed and neither said
   * so. The user saw nothing wrong until the next Daily Review served
   * everything at once, weeks after the signup that caused it.
   *
   * Optional, and omitting them keeps the schema defaults: an older client
   * that does not send them must still import cleanly, and a highlight
   * genuinely never reviewed has nothing to send.
   */
  easinessFactor?: number;
  intervalDays?: number;
  repetitions?: number;
  nextDueAt?: string | null;
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

  /**
   * localId -> server Article id, for every article this request resolved
   * (created *and* skipped-as-duplicate alike).
   *
   * The route has always built this map internally to attach highlights; it
   * just never sent it. Without it the client cannot finish migrating an
   * uploaded PDF or EPUB (#172): the bytes live in IndexedDB keyed by the
   * *local* id, the server mints a fresh id on import, and nothing connects
   * the two -- so the article arrived with fileStorageKey: null and the
   * reader opened it empty, forever, while the file sat on the user's disk.
   */
  localIdToServerId: Record<string, string>;
}
