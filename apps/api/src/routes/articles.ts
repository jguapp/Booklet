import type { FastifyInstance } from "fastify";
import type {
  Article,
  ArticleListResponse,
  ArticleStatus,
  ArticleSummary,
  CreateArticleRequest,
  UpdateArticleRequest,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { ExtractionError, fetchAndExtract } from "../services/extraction-service.js";

type ArticleRow = Awaited<ReturnType<typeof prisma.article.findFirstOrThrow>>;

const STATUSES: ArticleStatus[] = ["UNREAD", "READING", "ARCHIVED"];
const LIST_PAGE_SIZE = 30;

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    title: row.title,
    author: row.author,
    siteName: row.siteName,
    excerpt: row.excerpt,
    sourceType: row.sourceType,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError,
    extractedHtml: row.extractedHtml,
    extractedText: row.extractedText,
    fileStorageKey: row.fileStorageKey,
    originalFilename: row.originalFilename,
    readingTimeEstimate: row.readingTimeEstimate,
    progressFraction: row.progressFraction,
    status: row.status,
    savedAt: row.savedAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummary(row: ArticleRow): ArticleSummary {
  const { extractedHtml: _html, extractedText: _text, ...rest } = toArticle(row);
  return rest;
}

export async function registerArticleRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateArticleRequest }>(
    "/api/articles",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { url } = request.body ?? {};
      if (typeof url !== "string" || !url.trim()) {
        return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
      }

      const existing = await prisma.article.findUnique({
        where: { userId_url: { userId: request.userId!, url } },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "already_saved", message: "You've already saved this article." });
      }

      let extracted: Awaited<ReturnType<typeof fetchAndExtract>> | null = null;
      let extractionError: string | null = null;
      try {
        extracted = await fetchAndExtract(url);
      } catch (err) {
        extractionError = err instanceof ExtractionError ? err.message : "Extraction failed.";
      }

      const article = await prisma.article.create({
        data: {
          userId: request.userId!,
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
          readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
        },
      });

      return reply.code(201).send(toArticle(article));
    },
  );

  app.get("/api/articles", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { status?: string; cursor?: string; limit?: string };

    if (query.status && !STATUSES.includes(query.status as ArticleStatus)) {
      return reply.code(400).send({ error: "invalid_status", message: "Invalid status filter." });
    }
    const limit = Math.min(Math.max(Number(query.limit) || LIST_PAGE_SIZE, 1), 100);

    const rows = await prisma.article.findMany({
      where: {
        userId: request.userId!,
        ...(query.status ? { status: query.status as ArticleStatus } : {}),
      },
      orderBy: [{ savedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const body: ArticleListResponse = {
      articles: page.map(toSummary),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
    return reply.send(body);
  });

  app.get<{ Params: { id: string } }>(
    "/api/articles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const article = await prisma.article.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!article) return reply.code(404).send({ error: "not_found", message: "Article not found." });
      return reply.send(toArticle(article));
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateArticleRequest }>(
    "/api/articles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.article.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Article not found." });

      const { status, progressFraction } = request.body ?? {};
      if (status !== undefined && !STATUSES.includes(status)) {
        return reply.code(400).send({ error: "invalid_status", message: "Invalid status." });
      }
      if (
        progressFraction !== undefined &&
        (typeof progressFraction !== "number" || progressFraction < 0 || progressFraction > 1)
      ) {
        return reply.code(400).send({ error: "invalid_progress", message: "progressFraction must be 0-1." });
      }

      const now = new Date();
      const article = await prisma.article.update({
        where: { id: existing.id },
        data: {
          ...(progressFraction !== undefined ? { progressFraction } : {}),
          ...(status !== undefined
            ? {
                status,
                readAt: status === "READING" && !existing.readAt ? now : existing.readAt,
                archivedAt: status === "ARCHIVED" && !existing.archivedAt ? now : existing.archivedAt,
                ...(status === "UNREAD" ? { readAt: null, archivedAt: null } : {}),
              }
            : {}),
        },
      });

      return reply.send(toArticle(article));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/articles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.article.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Article not found." });
      await prisma.article.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );
}
