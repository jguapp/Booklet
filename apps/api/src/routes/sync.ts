import type { FastifyInstance } from "fastify";
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ImportRequest }>("/api/sync/import", { preHandler: requireAuth }, async (request, reply) => {
    const {
      articles,
      highlights,
      collections = [],
      articleCollections = [],
    } = request.body ?? { articles: [], highlights: [] };
    const userId = request.userId!;

    if (!Array.isArray(articles) || !Array.isArray(highlights)) {
      return reply.code(400).send({ error: "invalid_body", message: "articles and highlights must be arrays." });
    }

    // localId -> real server Article id, so highlights can attach whether
    // their article was newly created here or already existed (same URL).
    const localIdToServerId = new Map<string, string>();
    let importedArticles = 0;
    let skippedArticles = 0;

    for (const a of articles) {
      if (typeof a.localId !== "string" || !a.localId) continue;

      if (a.url) {
        const existing = await prisma.article.findUnique({ where: { userId_url: { userId, url: a.url } } });
        if (existing) {
          localIdToServerId.set(a.localId, existing.id);
          skippedArticles++;
          continue;
        }
      }

      const created = await prisma.article.create({
        data: {
          userId,
          url: a.url ?? null,
          title: a.title ?? null,
          author: a.author ?? null,
          siteName: a.siteName ?? null,
          excerpt: a.excerpt ?? null,
          sourceType: a.sourceType ?? "HTML",
          extractionStatus: a.extractionStatus ?? "SUCCESS",
          extractionError: a.extractionError ?? null,
          extractedHtml: a.extractedHtml ?? null,
          extractedText: a.extractedText ?? null,
          readingTimeEstimate: a.readingTimeEstimate ?? null,
          progressFraction: typeof a.progressFraction === "number" ? a.progressFraction : 0,
          status: a.status ?? "UNREAD",
          savedAt: a.savedAt ? new Date(a.savedAt) : new Date(),
          readAt: a.readAt ? new Date(a.readAt) : null,
          archivedAt: a.archivedAt ? new Date(a.archivedAt) : null,
        },
      });
      localIdToServerId.set(a.localId, created.id);
      importedArticles++;
    }

    let importedHighlights = 0;
    for (const h of highlights) {
      const articleId = localIdToServerId.get(h.localArticleId);
      if (!articleId) continue; // that article's import was skipped/invalid -- nothing to attach to
      if (typeof h.selectedText !== "string" || !h.selectedText) continue;
      if (typeof h.position !== "object" || h.position === null) continue;

      const noteText = h.noteText?.trim();
      await prisma.highlight.create({
        data: {
          articleId,
          userId,
          selectedText: h.selectedText,
          position: h.position as object,
          color: h.color ?? "YELLOW",
          lastSurfacedAt: h.lastSurfacedAt ? new Date(h.lastSurfacedAt) : null,
          surfaceCount: typeof h.surfaceCount === "number" ? h.surfaceCount : 0,
          lastFeedback: h.lastFeedback ?? null,
          lastFeedbackAt: h.lastFeedbackAt ? new Date(h.lastFeedbackAt) : null,
          resurfaceArchivedAt: h.resurfaceArchivedAt ? new Date(h.resurfaceArchivedAt) : null,
          createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
          ...(noteText ? { annotation: { create: { userId, noteText } } } : {}),
        },
      });
      importedHighlights++;
    }

    const localCollectionIdToServerId = new Map<string, string>();
    let importedCollections = 0;
    let skippedCollections = 0;

    for (const c of collections) {
      if (typeof c.localId !== "string" || !c.localId) continue;
      const name = c.name?.trim();
      if (!name) continue;

      const existing = await prisma.collection.findUnique({ where: { userId_name: { userId, name } } });
      if (existing) {
        localCollectionIdToServerId.set(c.localId, existing.id);
        skippedCollections++;
        continue;
      }

      const created = await prisma.collection.create({ data: { userId, name, color: c.color ?? null } });
      localCollectionIdToServerId.set(c.localId, created.id);
      importedCollections++;
    }

    for (const link of articleCollections) {
      const articleId = localIdToServerId.get(link.localArticleId);
      const collectionId = localCollectionIdToServerId.get(link.localCollectionId);
      if (!articleId || !collectionId) continue;
      await prisma.articleCollection.upsert({
        where: { articleId_collectionId: { articleId, collectionId } },
        create: { articleId, collectionId },
        update: {},
      });
    }

    const body: ImportResponse = {
      importedArticles,
      skippedArticles,
      importedHighlights,
      importedCollections,
      skippedCollections,
    };
    return reply.send(body);
  });
}
