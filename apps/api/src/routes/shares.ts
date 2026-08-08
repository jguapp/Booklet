import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  ContributionSettings,
  CreateShareRequest,
  OnboardingSeedsResponse,
  PublicShareResponse,
  PublicSharedArticle,
  Share,
  ShareTargetType,
  UpdateContributionSettingsRequest,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { getOnboardingSeeds, recomputePublicHighlightStats } from "../services/aggregation-service.js";

/**
 * Public sharing (#158 part 1). Two very different halves live in this file:
 * the owner-facing routes under /api/shares, all behind requireAuth, and the
 * unauthenticated reader-facing routes under /api/public.
 *
 * The /api/public routes are the only endpoints in this app that serve one
 * user's content to an anonymous stranger, so everything they return is
 * assembled field by field below rather than derived from a row.
 */

/**
 * Slug entropy: 16 random bytes, base64url-encoded to 22 characters.
 *
 * The slug *is* the access control -- there is no second check, by design
 * (an unlisted link you can forward to someone without an account is the
 * entire feature). So it is sized as a capability, not as a URL slug. 128
 * bits means an attacker guessing a billion slugs a second for a hundred
 * years still has about a 1-in-10^22 chance of hitting any single one, and
 * that is before the rate limit below, which caps a real attacker four
 * hundred million times below that rate anyway.
 *
 * randomBytes, not Math.random: Math.random is a fast non-cryptographic PRNG
 * whose internal state can be recovered from a handful of outputs, which for
 * a capability URL means recovering every slug the process has ever minted
 * and every one it will mint next.
 */
const SLUG_BYTES = 16;

function generateSlug(): string {
  return randomBytes(SLUG_BYTES).toString("base64url");
}

/**
 * Public reads get their own, tighter bucket than the app-wide 300/minute.
 * The global limit exists to stop abuse of expensive endpoints; this one
 * exists to make slug enumeration hopeless in wall-clock terms as well as in
 * arithmetic terms, and it applies to anonymous traffic where there is no
 * account to hold responsible afterwards.
 */
const PUBLIC_READ_LIMIT = {
  max: Number(process.env.PUBLIC_SHARE_RATE_LIMIT_MAX) || 120,
  timeWindow: "1 minute",
};

/**
 * A hard ceiling on how many highlights one public page publishes.
 *
 * Bounds the response, but the reason it isn't much larger is the copyright
 * one: a page of a reader's own excerpts is fair; a page that reproduces
 * every sentence of a copyrighted article because somebody highlighted the
 * whole thing is a republication wearing a highlight's clothes.
 */
const MAX_PUBLIC_HIGHLIGHTS = 300;

/**
 * One message for every reason a slug doesn't resolve -- never seen, revoked
 * an hour ago, or pointing at an article that has since been trashed. A
 * distinct "this link was revoked" response would confirm to anyone holding
 * a leaked URL that the account and the page were real, which is exactly the
 * fact revocation is supposed to take away.
 */
const NOT_FOUND = { error: "not_found", message: "This link isn't available." };

function toShare(row: {
  id: string;
  slug: string;
  articleId: string | null;
  collectionId: string | null;
  viewCount: number;
  createdAt: Date;
}): Share {
  return {
    id: row.id,
    slug: row.slug,
    targetType: (row.articleId ? "article" : "collection") satisfies ShareTargetType,
    articleId: row.articleId,
    collectionId: row.collectionId,
    viewCount: row.viewCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The exact set of Article columns a public page is allowed to see. Written
 * as a Prisma `select` rather than as a filter applied afterwards, so the
 * private columns are never even fetched -- extractedText, extractedHtml,
 * excerpt, coverImageUrl, tags, status, progressFraction, readingTimeEstimate,
 * userId and the rest cannot leak through a later refactor that spreads the
 * row, because they aren't in the object to spread.
 *
 * excerpt and coverImageUrl are absent deliberately even though they'd look
 * nice: both are the publisher's content lifted off the original page, not
 * the reader's own selection, which is the line this feature stays on.
 */
const PUBLIC_ARTICLE_SELECT = {
  id: true,
  title: true,
  author: true,
  siteName: true,
  url: true,
} as const;

// No id and no timestamps: a stranger holding the link has no use for either,
// and "when did they read this" is a fact about the owner's habits rather
// than about the passage.
const PUBLIC_HIGHLIGHT_SELECT = {
  selectedText: true,
  color: true,
  annotation: { select: { noteText: true } },
} as const;

type PublicArticleRow = {
  id: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  url: string | null;
};

type PublicHighlightRow = {
  selectedText: string;
  color: string;
  annotation: { noteText: string } | null;
};

function toPublicArticle(article: PublicArticleRow, highlights: PublicHighlightRow[]): PublicSharedArticle {
  return {
    source: {
      title: article.title ?? "Untitled",
      author: article.author,
      siteName: article.siteName,
      url: article.url,
    },
    highlights: highlights.map((h) => ({
      text: h.selectedText,
      note: h.annotation?.noteText ?? null,
      color: h.color,
    })),
  };
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateShareRequest }>("/api/shares", { preHandler: requireAuth }, async (request, reply) => {
    const { articleId, collectionId } = request.body ?? {};
    const userId = request.userId!;

    // The Share model can only express one target at a time (see its schema
    // comment on why that isn't a polymorphic pair), so this is where that
    // invariant is actually enforced.
    if ((!articleId && !collectionId) || (articleId && collectionId)) {
      return reply
        .code(400)
        .send({ error: "invalid_target", message: "Pass exactly one of articleId or collectionId." });
    }

    if (articleId) {
      const article = await prisma.article.findFirst({
        where: { id: articleId, userId, deletedAt: null },
        select: { id: true },
      });
      if (!article) return reply.code(404).send({ error: "not_found", message: "Article not found." });
    } else {
      const collection = await prisma.collection.findFirst({
        where: { id: collectionId, userId },
        select: { id: true, filter: true },
      });
      if (!collection) return reply.code(404).send({ error: "not_found", message: "Collection not found." });
      // A smart collection's membership is a live query, so its shared page
      // would silently start publishing articles saved *after* the link went
      // out -- the owner would be consenting to publish things that don't
      // exist yet. Sharing one is refused rather than quietly snapshotted,
      // since a snapshot is not what the collection means anywhere else in
      // the app.
      if (collection.filter) {
        return reply.code(400).send({
          error: "smart_collection",
          message: "Smart collections change as your library does — share a regular collection instead.",
        });
      }
    }

    // Re-sharing something already shared returns the existing link instead
    // of minting a second one: two live slugs for one page means revoking
    // "the" link leaves the other one working, which is the exact failure
    // revocation exists to prevent.
    const existing = await prisma.share.findFirst({
      where: { userId, ...(articleId ? { articleId } : { collectionId }) },
    });
    if (existing) return reply.code(200).send(toShare(existing));

    const created = await prisma.share.create({
      data: {
        userId,
        slug: generateSlug(),
        ...(articleId ? { articleId } : { collectionId }),
      },
    });
    return reply.code(201).send(toShare(created));
  });

  app.get("/api/shares", { preHandler: requireAuth }, async (request, reply) => {
    const rows = await prisma.share.findMany({
      where: { userId: request.userId! },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(rows.map(toShare));
  });

  app.delete<{ Params: { id: string } }>(
    "/api/shares/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.share.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Share not found." });

      // Revocation deletes the row. Nothing keeps the old slug afterwards,
      // so there is no state left to flip back and no leaked URL that can be
      // resurrected -- re-sharing mints a brand-new slug and the old link is
      // dead permanently. See the Share model's schema comment.
      await prisma.share.delete({ where: { id: existing.id } });

      // The passages on that page are no longer public, so they must stop
      // counting toward the cross-user aggregate. Only contributors have
      // anything in there to remove, so a non-contributor pays nothing for
      // this. Fire-and-forget: the revoke itself already succeeded, and
      // failing the request because a bookkeeping rebuild hiccuped would be
      // the worse outcome for a privacy control.
      const owner = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: { contributesToPublicHighlights: true },
      });
      if (owner?.contributesToPublicHighlights) {
        recomputePublicHighlightStats().catch(() => undefined);
      }

      return reply.code(204).send();
    },
  );

  app.get("/api/shares/contribution", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId! },
      select: { contributesToPublicHighlights: true },
    });
    const body: ContributionSettings = {
      contributesToPublicHighlights: user?.contributesToPublicHighlights ?? false,
    };
    return reply.send(body);
  });

  app.put<{ Body: UpdateContributionSettingsRequest }>(
    "/api/shares/contribution",
    { preHandler: requireAuth },
    async (request, reply) => {
      const value = request.body?.contributesToPublicHighlights;
      if (typeof value !== "boolean") {
        return reply
          .code(400)
          .send({ error: "invalid_body", message: "contributesToPublicHighlights must be a boolean." });
      }

      await prisma.user.update({
        where: { id: request.userId! },
        data: { contributesToPublicHighlights: value },
      });

      // Withdrawing consent has to take effect now, not at whenever the next
      // rebuild happens to run -- an opt-out that leaves your passages in the
      // aggregate for a day is not an opt-out. Turning it *on* rebuilds for
      // symmetry, so the switch means the same thing in both directions.
      await recomputePublicHighlightStats();

      const body: ContributionSettings = { contributesToPublicHighlights: value };
      return reply.send(body);
    },
  );

  /**
   * The public page. No requireAuth, deliberately -- the whole point is a
   * link that works for someone who has never heard of Booklet.
   *
   * On timing: the lookup is a single unique-index hit on the slug, with no
   * secret comparison anywhere, and a revoked share's row is gone rather
   * than filtered out. That last part is what makes the timing argument hold
   * -- a soft-deleted row would have meant a revoked slug taking a
   * measurably different path from a slug that never existed.
   */
  app.get<{ Params: { slug: string } }>(
    "/api/public/shares/:slug",
    { config: { rateLimit: PUBLIC_READ_LIMIT } },
    async (request, reply) => {
      const share = await prisma.share.findUnique({
        where: { slug: request.params.slug },
        select: { id: true, articleId: true, collectionId: true, createdAt: true },
      });
      if (!share) return reply.code(404).send(NOT_FOUND);

      let title: string;
      let articles: PublicSharedArticle[];
      let targetType: ShareTargetType;

      if (share.articleId) {
        targetType = "article";
        const article = await prisma.article.findFirst({
          where: { id: share.articleId, deletedAt: null },
          select: PUBLIC_ARTICLE_SELECT,
        });
        // Trashing an article takes its public page down with it. The Share
        // row survives (the article row does too, for 30 days of undo), so
        // this check is what stops a link from outliving the owner's "I'm
        // done with this".
        if (!article) return reply.code(404).send(NOT_FOUND);

        const highlights = await prisma.highlight.findMany({
          where: { articleId: article.id },
          select: PUBLIC_HIGHLIGHT_SELECT,
          orderBy: { createdAt: "asc" },
          take: MAX_PUBLIC_HIGHLIGHTS,
        });
        title = article.title ?? "Untitled";
        articles = [toPublicArticle(article, highlights)];
      } else {
        targetType = "collection";
        const collection = await prisma.collection.findUnique({
          where: { id: share.collectionId! },
          select: { id: true, name: true },
        });
        if (!collection) return reply.code(404).send(NOT_FOUND);

        const links = await prisma.articleCollection.findMany({
          where: { collectionId: collection.id, article: { deletedAt: null } },
          select: { article: { select: PUBLIC_ARTICLE_SELECT } },
          orderBy: { addedAt: "desc" },
        });

        const highlights = await prisma.highlight.findMany({
          where: { articleId: { in: links.map((l) => l.article.id) } },
          select: { ...PUBLIC_HIGHLIGHT_SELECT, articleId: true },
          orderBy: { createdAt: "asc" },
          take: MAX_PUBLIC_HIGHLIGHTS,
        });
        const byArticle = new Map<string, PublicHighlightRow[]>();
        for (const h of highlights) {
          const list = byArticle.get(h.articleId);
          if (list) list.push(h);
          else byArticle.set(h.articleId, [h]);
        }

        title = collection.name;
        // An article with no highlights contributes nothing but its title,
        // and its title is a fact about the owner's library rather than
        // something they highlighted -- so it isn't published at all.
        articles = links
          .filter((l) => byArticle.has(l.article.id))
          .map((l) => toPublicArticle(l.article, byArticle.get(l.article.id)!));
      }

      // Fire-and-forget, same reasoning as the API token's lastUsedAt: a
      // view counter is bookkeeping and must not be able to fail a reader's
      // page load.
      prisma.share.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);

      const body: PublicShareResponse = {
        targetType,
        title,
        sharedAt: share.createdAt.toISOString(),
        articles,
        highlightCount: articles.reduce((sum, a) => sum + a.highlights.length, 0),
      };
      return reply.send(body);
    },
  );

  /**
   * Onboarding seeds (#158 part 2). Unauthenticated because the moment it
   * serves is "someone has just arrived and has nothing yet", which includes
   * the local-only, never-signed-up mode this app supports throughout.
   *
   * Safe to leave open because of what it can contain: public-domain text
   * shipped in this repo, and aggregate passages that already cleared both
   * the opt-in and the distinct-user threshold and carry no identity of any
   * kind. There is nothing here to authenticate access to.
   */
  app.get("/api/public/seeds", { config: { rateLimit: PUBLIC_READ_LIMIT } }, async (_request, reply) => {
    const body: OnboardingSeedsResponse = await getOnboardingSeeds();
    return reply.send(body);
  });
}
