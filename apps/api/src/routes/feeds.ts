import type { FastifyInstance } from "fastify";
import type { CreateFeedRequest, Feed, FetchedFeed } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { FeedFetchError, fetchFeed } from "../services/rss-service.js";

// Open URL-fetcher, same reasoning as /api/extract's own rate limit.
const PREVIEW_LIMIT = { max: 20, timeWindow: "10 minutes" };

type FeedRow = Awaited<ReturnType<typeof prisma.feed.findFirstOrThrow>>;

function toFeed(row: FeedRow): Feed {
  return { id: row.id, userId: row.userId, url: row.url, title: row.title, createdAt: row.createdAt.toISOString() };
}

export async function registerFeedRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Public (no auth) -- mirrors /api/extract's split for anonymous mode:
   * fetching/parsing a feed doesn't touch any user data, only *subscribing*
   * to one (persisted server-side for signed-in users, IndexedDB otherwise)
   * needs an account.
   */
  app.post<{ Body: { url?: string } }>(
    "/api/feeds/preview",
    { config: { rateLimit: PREVIEW_LIMIT } },
    async (request, reply) => {
      const { url } = request.body ?? {};
      if (typeof url !== "string" || !url.trim()) {
        return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
      }
      try {
        const fetched: FetchedFeed = await fetchFeed(url);
        return reply.send(fetched);
      } catch (err) {
        const message = err instanceof FeedFetchError ? err.message : "Couldn't fetch that feed.";
        return reply.code(422).send({ error: "feed_fetch_failed", message });
      }
    },
  );

  app.post<{ Body: CreateFeedRequest }>("/api/feeds", { preHandler: requireAuth }, async (request, reply) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !url.trim()) {
      return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
    }

    const existing = await prisma.feed.findUnique({ where: { userId_url: { userId: request.userId!, url } } });
    if (existing) {
      return reply.code(409).send({ error: "already_subscribed", message: "You're already subscribed to this feed." });
    }

    let fetched: FetchedFeed;
    try {
      fetched = await fetchFeed(url);
    } catch (err) {
      const message = err instanceof FeedFetchError ? err.message : "Couldn't fetch that feed.";
      return reply.code(422).send({ error: "feed_fetch_failed", message });
    }

    const feed = await prisma.feed.create({ data: { userId: request.userId!, url, title: fetched.title } });
    return reply.code(201).send(toFeed(feed));
  });

  app.get("/api/feeds", { preHandler: requireAuth }, async (request, reply) => {
    const feeds = await prisma.feed.findMany({
      where: { userId: request.userId! },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(feeds.map(toFeed));
  });

  app.get<{ Params: { id: string } }>(
    "/api/feeds/:id/items",
    { preHandler: requireAuth },
    async (request, reply) => {
      const feed = await prisma.feed.findFirst({ where: { id: request.params.id, userId: request.userId! } });
      if (!feed) return reply.code(404).send({ error: "not_found", message: "Feed not found." });

      try {
        const fetched: FetchedFeed = await fetchFeed(feed.url);
        return reply.send(fetched);
      } catch (err) {
        const message = err instanceof FeedFetchError ? err.message : "Couldn't fetch that feed.";
        return reply.code(422).send({ error: "feed_fetch_failed", message });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/feeds/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.feed.findFirst({ where: { id: request.params.id, userId: request.userId! } });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Feed not found." });
      await prisma.feed.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );
}
