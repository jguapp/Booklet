import type { Highlight } from "./highlight";

export type ArticleStatus = "UNREAD" | "READING" | "ARCHIVED";
export type SourceType = "HTML" | "PDF" | "EPUB" | "BOOK";
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
  /** Set only for a PDF whose native text layer was empty/unusable --
   * "OCR" means extractedText came from image recognition (Tesseract)
   * instead, which can contain real errors a native text layer never
   * would. Null for everything else. */
  textSource: "NATIVE" | "OCR" | null;
  fileStorageKey: string | null; // raw HTML snapshot (HTML) or the uploaded file itself (PDF/EPUB)
  originalFilename: string | null; // PDF/EPUB upload's original filename
  /** data: URI thumbnail for the library card -- HTML's <meta property="og:image">
   * (falling back to twitter:image), a PDF's rasterized first page, or an
   * EPUB's declared cover (falling back to its first spine image). Null
   * when nothing was found/fetchable; the card just omits the thumbnail. */
  coverImageUrl: string | null;

  readingTimeEstimate: number | null;
  /** How many images in the original page were too large/numerous to
   * inline (see extraction-service.ts's MAX_IMAGE_BYTES/MAX_TOTAL_IMAGE_BYTES/
   * MAX_IMAGES) and were left pointing at the original site instead --
   * meaning they can break if that page later changes. 0 for anything
   * that isn't an HTML save, or where nothing was skipped. */
  skippedImageCount: number;
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
  /** Set to "OCR" only for a PDF whose text layer was empty/unusable --
   * see Article.textSource. */
  textSource?: "NATIVE" | "OCR";
  /** See Article.skippedImageCount. Only ever set by the HTML extraction
   * path (fetchAndExtract) -- absent (not 0) for PDF/EPUB extraction,
   * which doesn't inline images at all. */
  skippedImageCount?: number;
  /** See Article.coverImageUrl. Absent (not null) when extraction didn't
   * even attempt to find one; null when it looked and found nothing. */
  coverImageUrl?: string | null;
}

export interface UpdateArticleRequest {
  status?: ArticleStatus;
  progressFraction?: number;
  tags?: string[];
  favorited?: boolean;
  /** User-renamed title -- overwrites whatever extraction found (or
   * "Untitled"). Trimmed, 1-300 chars. There's no separate "original
   * title" kept anywhere once this is set; it really does replace it. */
  title?: string;
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

/** Wraps a matched term inside a snippet. Deliberately a pair of C0 control
 * characters rather than `<mark>`: a snippet is cut from article text this
 * app did not author, so returning HTML would mean rendering attacker-
 * controlled markup (Postgres's ts_headline does not escape the document it
 * quotes from). Control characters cannot occur in extracted article text,
 * survive JSON transport, and let the UI split the string into plain React
 * nodes -- so nothing ever needs dangerouslySetInnerHTML to show a snippet. */
export const SNIPPET_MARK_START = "\u0002";
export const SNIPPET_MARK_END = "\u0003";

export interface SearchResponse {
  /** Ordered by relevance, best first -- not by savedAt. */
  articles: ArticleSummary[];
  highlights: Highlight[];
  /** articleId -> a short excerpt showing why it matched, with matched terms
   * wrapped in SNIPPET_MARK_START/END. Absent for an article that matched on
   * something with no body context to quote (a tag, or a title-only hit). */
  snippets?: Record<string, string>;
}
