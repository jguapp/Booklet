export type ArticleStatus = "UNREAD" | "READING" | "ARCHIVED";
export type SourceType = "HTML" | "PDF" | "EPUB";
export type ExtractionStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface Article {
  id: string;
  userId: string;

  url: string;
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

  status: ArticleStatus;
  savedAt: string;
  readAt: string | null;
  archivedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/** GET /api/articles list DTO -- omits the large extracted content fields. */
export type ArticleSummary = Omit<Article, "extractedHtml" | "extractedText">;
