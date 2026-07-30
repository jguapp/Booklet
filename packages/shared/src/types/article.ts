import type { Highlight } from "./highlight";

export type ArticleStatus = "UNREAD" | "READING" | "ARCHIVED";
export type SourceType = "HTML" | "PDF" | "EPUB";
export type ExtractionStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface Article {
  id: string;
  userId: string;

  url: string | null; // null for PDF/EPUB uploads -- there's no source URL for those
  /** Normalized form of `url` (see url-canonicalize.ts) -- used to catch a
   * "different URL, same article" duplicate (tracking-param variant, AMP
   * link) that exact matching on `url` misses. Null for PDF/EPUB uploads
   * and for articles saved before this field existed. */
  canonicalUrl: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;

  sourceType: SourceType;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  extractedHtml: string | null; // HTML only -- Readability output rendered in the reader
  extractedText: string | null; // all types -- HTML/PDF full text, EPUB full book text
  fileStorageKey: string | null; // raw HTML snapshot (HTML) or the uploaded file itself (PDF/EPUB)
  originalFilename: string | null; // PDF/EPUB upload's original filename

  readingTimeEstimate: number | null;
  progressFraction: number; // 0.0-1.0, normalized regardless of sourceType
  activeReadingSeconds: number; // actual time spent, not an estimate -- see the reading-stats feature

  tags: string[]; // free-form, lighter-weight than Collection -- no separate entity, no color

  status: ArticleStatus;
  savedAt: string;
  readAt: string | null;
  archivedAt: string | null;

  favorited: boolean;
  /** Set instead of actually removing the row -- see Trash. Independent of
   * `status`, so restoring gives back whatever status it had. Non-null means
   * "in trash", regardless of how long ago -- the 30-day retention window is
   * enforced by purging on read, not by this field's presence alone. */
  deletedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/** GET /api/articles list DTO -- omits the large extracted content fields. */
export type ArticleSummary = Omit<Article, "extractedHtml" | "extractedText">;

/** POST /api/articles, POST /api/extract -- PDF/EPUB upload is a later phase, URL-only for now. */
export interface CreateArticleRequest {
  url: string;
}

/** Shared by the authed persist-and-extract route and the public extract-only route. */
export interface ExtractedContent {
  title: string | null;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  html: string | null;
  text: string | null;
  readingTimeEstimate: number | null;
}

export interface UpdateArticleRequest {
  status?: ArticleStatus;
  progressFraction?: number;
  tags?: string[];
  favorited?: boolean;
  /** Set to trash it, null to restore. */
  deletedAt?: string | null;
  /** Seconds to add to activeReadingSeconds since the last flush -- an
   * atomic increment server-side, not an overwrite, so concurrent
   * flushes (e.g. two tabs) can't clobber each other. */
  activeReadingSecondsDelta?: number;
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  nextCursor: string | null;
}

/** GET /api/search */
export interface SearchResponse {
  articles: ArticleSummary[];
  highlights: Highlight[];
}
