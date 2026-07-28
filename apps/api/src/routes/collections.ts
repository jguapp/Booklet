import type { FastifyInstance } from "fastify";
import type {
  Article,
  ArticleSummary,
  Collection,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";

function toCollection(row: {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { articles: number };
}): Collection {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row._count ? { articleCount: row._count.articles } : {}),
  };
}

function toArticleSummary(row: Parameters<typeof toArticle>[0]): ArticleSummary {
  const { extractedHtml: _html, extractedText: _text, ...rest } = toArticle(row);
  return rest;
}

function toArticle(row: {
  id: string;
  userId: string;
  url: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  sourceType: Article["sourceType"];
  extractionStatus: Article["extractionStatus"];
  extractionError: string | null;
  extractedHtml: string | null;
  extractedText: string | null;
  fileStorageKey: string | null;
  originalFilename: string | null;
  readingTimeEstimate: number | null;
  progressFraction: number;
  status: Article["status"];
  savedAt: Date;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Article {
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

export async function registerCollectionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateCollectionRequest }>(
    "/api/collections",
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = request.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "invalid_name", message: "A name is required." });

      const existing = await prisma.collection.findUnique({
        where: { userId_name: { userId: request.userId!, name } },
      });
      if (existing) {
        return reply.code(409).send({ error: "already_exists", message: "You already have a collection with that name." });
      }

      const created = await prisma.collection.create({
        data: { userId: request.userId!, name, color: request.body?.color ?? null },
      });
      return reply.code(201).send(toCollection({ ...created, _count: { articles: 0 } }));
    },
  );

  app.get("/api/collections", { preHandler: requireAuth }, async (request, reply) => {
    const rows = await prisma.collection.findMany({
      where: { userId: request.userId! },
      include: { _count: { select: { articles: true } } },
      orderBy: { name: "asc" },
    });
    return reply.send(rows.map(toCollection));
  });

  app.patch<{ Params: { id: string }; Body: UpdateCollectionRequest }>(
    "/api/collections/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.collection.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Collection not found." });

      const name = request.body?.name?.trim();
      if (request.body?.name !== undefined && !name) {
        return reply.code(400).send({ error: "invalid_name", message: "Name can't be empty." });
      }

      const updated = await prisma.collection.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(request.body?.color !== undefined ? { color: request.body.color } : {}),
        },
        include: { _count: { select: { articles: true } } },
      });
      return reply.send(toCollection(updated));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/collections/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.collection.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Collection not found." });
      await prisma.collection.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/collections/:id/articles",
    { preHandler: requireAuth },
    async (request, reply) => {
      const collection = await prisma.collection.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!collection) return reply.code(404).send({ error: "not_found", message: "Collection not found." });

      const links = await prisma.articleCollection.findMany({
        where: { collectionId: collection.id },
        include: { article: true },
        orderBy: { addedAt: "desc" },
      });
      return reply.send(links.map((l) => toArticleSummary(l.article)));
    },
  );

  app.put<{ Params: { id: string; articleId: string } }>(
    "/api/collections/:id/articles/:articleId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const [collection, article] = await Promise.all([
        prisma.collection.findFirst({ where: { id: request.params.id, userId: request.userId! } }),
        prisma.article.findFirst({ where: { id: request.params.articleId, userId: request.userId! } }),
      ]);
      if (!collection || !article) {
        return reply.code(404).send({ error: "not_found", message: "Collection or article not found." });
      }

      await prisma.articleCollection.upsert({
        where: { articleId_collectionId: { articleId: article.id, collectionId: collection.id } },
        create: { articleId: article.id, collectionId: collection.id },
        update: {},
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string; articleId: string } }>(
    "/api/collections/:id/articles/:articleId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const collection = await prisma.collection.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!collection) return reply.code(404).send({ error: "not_found", message: "Collection not found." });

      await prisma.articleCollection.deleteMany({
        where: { collectionId: collection.id, articleId: request.params.articleId },
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/articles/:id/collections",
    { preHandler: requireAuth },
    async (request, reply) => {
      const article = await prisma.article.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!article) return reply.code(404).send({ error: "not_found", message: "Article not found." });

      const links = await prisma.articleCollection.findMany({
        where: { articleId: article.id },
        include: { collection: true },
      });
      return reply.send(links.map((l) => toCollection(l.collection)));
    },
  );
}
