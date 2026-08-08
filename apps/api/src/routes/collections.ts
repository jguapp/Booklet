import type { FastifyInstance } from "fastify";
import type {
  ArticleCollectionMemberships,
  Collection,
  CollectionFilter,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from "@booklet/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { toSummary as toArticleSummary } from "./articles.js";

export function toCollection(row: {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  filter: unknown;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { articles: number };
}): Collection {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: row.color,
    filter: (row.filter as CollectionFilter | null) ?? null,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row._count ? { articleCount: row._count.articles } : {}),
  };
}

const STATUSES = ["UNREAD", "READING", "ARCHIVED"];
const MAX_FILTER_TAGS = 50;
const MAX_FILTER_TEXT = 200;

/**
 * Whether a smart collection's filter is one this app can express.
 *
 * The body's `filter` was stored as whatever JSON arrived and then spread
 * into a Prisma where-clause by filterToArticleWhere below, one field per
 * column. Prisma's scalar filters accept an *object* of operators, so
 * `{"status":{"not":"UNREAD"}}` was stored happily and every field that is
 * not a string arrived at the driver as a shape it could not use.
 *
 * The damage is not a data leak -- userId and deletedAt are set by this
 * server on the same clause and a scalar filter cannot reach another table
 * -- it is that the bad filter is *stored*. Confirmed by injection: one such
 * create (201) then made GET /api/collections/:id/articles return 500
 * forever, and with it GET /api/articles/collection-memberships, which
 * evaluates every smart collection the account has and is what the library
 * page asks for on load. One malformed filter, and the library stops
 * rendering until the collection is deleted through an API call.
 *
 * So: checked at the boundary, where a 400 is still possible, rather than
 * trusted because the TypeScript type says CollectionFilter.
 */
function isValidCollectionFilter(value: unknown): value is CollectionFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const filter = value as Record<string, unknown>;
  if (Object.keys(filter).some((key) => !["status", "tags", "favorited", "textQuery"].includes(key))) return false;
  if (filter.status !== undefined && (typeof filter.status !== "string" || !STATUSES.includes(filter.status))) {
    return false;
  }
  if (filter.favorited !== undefined && typeof filter.favorited !== "boolean") return false;
  if (
    filter.textQuery !== undefined &&
    (typeof filter.textQuery !== "string" || filter.textQuery.length > MAX_FILTER_TEXT)
  ) {
    return false;
  }
  if (filter.tags !== undefined) {
    if (!Array.isArray(filter.tags) || filter.tags.length > MAX_FILTER_TAGS) return false;
    if (filter.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 40)) return false;
  }
  return true;
}

/** Builds the Article where-clause a smart collection's filter describes.
 * AND semantics only -- see CollectionFilter's own doc comment for why. */
function filterToArticleWhere(userId: string, filter: CollectionFilter): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = { userId, deletedAt: null };
  if (filter.status) where.status = filter.status;
  if (filter.favorited) where.favorited = true;
  if (filter.tags && filter.tags.length > 0) where.tags = { hasEvery: filter.tags };
  if (filter.textQuery) {
    const contains = { contains: filter.textQuery, mode: "insensitive" as const };
    where.OR = [{ title: contains }, { excerpt: contains }, { extractedText: contains }];
  }
  return where;
}

/** True if `candidateId` is `ancestorId` itself or a descendant of it --
 * both would create a cycle if `candidateId` were made ancestorId's
 * parent. Walks up from candidateId rather than down from ancestorId
 * since a collection tree is expected to be shallow and this only runs on
 * the rare re-parent action, not a hot path. */
async function wouldCreateCycle(userId: string, ancestorId: string, candidateId: string): Promise<boolean> {
  let cursor: string | null = candidateId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    const row: { parentId: string | null } | null = await prisma.collection.findFirst({
      where: { id: cursor, userId },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
  }
  return false;
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

      // The same ownership check PATCH already does on parentId, which
      // create never did. Two things came of that. A collection could be
      // parented to *another account's* collection -- Collection.parentId is
      // a plain FK with no userId in it, so Postgres accepted the row
      // (confirmed: 201) and the tree then spanned two libraries, with
      // deleting the stranger's parent silently reaching into this account
      // via onDelete: SetNull. And the two failure modes differed: a parentId
      // that exists somewhere returned 201 while one that exists nowhere hit
      // the FK constraint and returned 500, which is an existence oracle for
      // any collection id in the system. Both answers are now 404.
      const filter = request.body?.filter;
      if (filter !== undefined && filter !== null && !isValidCollectionFilter(filter)) {
        return reply.code(400).send({
          error: "invalid_filter",
          message: "A smart collection's filter may only set status, tags, favorited and textQuery.",
        });
      }

      const parentId = request.body?.parentId ?? null;
      if (parentId !== null) {
        const parent = await prisma.collection.findFirst({
          where: { id: parentId, userId: request.userId! },
          select: { id: true },
        });
        if (!parent) return reply.code(404).send({ error: "not_found", message: "Parent collection not found." });
      }

      const created = await prisma.collection.create({
        data: {
          userId: request.userId!,
          name,
          color: request.body?.color ?? null,
          filter: filter ? (filter as Prisma.InputJsonValue) : undefined,
          parentId,
        },
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

      if (request.body?.parentId !== undefined && request.body.parentId !== null) {
        if (request.body.parentId === existing.id) {
          return reply.code(400).send({ error: "invalid_parent", message: "A collection can't contain itself." });
        }
        const parent = await prisma.collection.findFirst({
          where: { id: request.body.parentId, userId: request.userId! },
        });
        if (!parent) return reply.code(404).send({ error: "not_found", message: "Parent collection not found." });
        if (await wouldCreateCycle(request.userId!, existing.id, request.body.parentId)) {
          return reply
            .code(400)
            .send({ error: "invalid_parent", message: "That would nest a collection inside its own descendant." });
        }
      }

      const updated = await prisma.collection.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(request.body?.color !== undefined ? { color: request.body.color } : {}),
          ...(request.body?.parentId !== undefined ? { parentId: request.body.parentId } : {}),
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

      if (collection.filter) {
        // toArticleSummary strips extractedHtml/extractedText from every
        // result anyway (see its own comment in articles.ts) -- omitting
        // them here means Postgres never sends them for a match in the
        // first place.
        const articles = await prisma.article.findMany({
          omit: { extractedHtml: true, extractedText: true },
          where: filterToArticleWhere(request.userId!, collection.filter as CollectionFilter),
          orderBy: [{ savedAt: "desc" }, { id: "desc" }],
        });
        return reply.send(articles.map(toArticleSummary));
      }

      const links = await prisma.articleCollection.findMany({
        where: { collectionId: collection.id },
        include: { article: { omit: { extractedHtml: true, extractedText: true } } },
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
      if (collection.filter) {
        return reply
          .code(400)
          .send({ error: "smart_collection", message: "This collection's contents are computed from its filter." });
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

  // Bulk membership for every article at once -- library-card badges need
  // to know "is this article in a collection" for a whole page of cards,
  // and a per-card call to the route below would be N+1. Ordinary
  // (non-smart) membership is one query; each smart collection then costs
  // one more (reusing filterToArticleWhere, the same logic its own
  // /articles route already uses) -- bounded by how many smart collections
  // exist, not how many articles are on screen.
  app.get("/api/articles/collection-memberships", { preHandler: requireAuth }, async (request, reply) => {
    const [collections, links] = await Promise.all([
      prisma.collection.findMany({ where: { userId: request.userId! } }),
      prisma.articleCollection.findMany({
        where: { collection: { userId: request.userId! } },
        select: { articleId: true, collectionId: true },
      }),
    ]);

    const membership: ArticleCollectionMemberships = {};
    for (const link of links) {
      (membership[link.articleId] ??= []).push(link.collectionId);
    }

    const smartCollections = collections.filter((c) => c.filter);
    for (const collection of smartCollections) {
      const matches = await prisma.article.findMany({
        where: filterToArticleWhere(request.userId!, collection.filter as CollectionFilter),
        select: { id: true },
      });
      for (const { id } of matches) {
        (membership[id] ??= []).push(collection.id);
      }
    }

    return reply.send(membership);
  });

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
