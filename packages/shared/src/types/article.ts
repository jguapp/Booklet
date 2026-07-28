export type ArticleStatus = "UNREAD" | "READING" | "ARCHIVED";
export type SourceType = "HTML" | "PDF" | "EPUB";
export type ExtractionStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface Article {
  id: string;
  userId: string;

  url: string | null; // null for PDF/EPUB uploads -- there's no source URL for those
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

  status: ArticleStatus;
  savedAt: string;
  readAt: string | null;
  archivedAt: string | null;

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
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  nextCursor: string | null;
}
