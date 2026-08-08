import type { FastifyInstance } from "fastify";
import type { Digest } from "@booklet/shared";
import { compileDigestEmail } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { getHighlightsToResurface } from "../services/resurface-service.js";
import { sendEmail } from "../services/email-service.js";
// The same serializer the /api/highlights routes use, not a second copy.
// This file used to carry its own identical one, which is exactly the kind
// of duplicate that goes stale silently: adding Highlight.prompt (#157) to
// one of them would have left digests -- the one place the field actually
// changes what the reader sees -- serving highlights without it.
import { toHighlight } from "./highlights.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Email me this digest" had no limit beyond the API-wide 300/minute, which
 * is 300 messages a minute through this server's mail provider for one signed-in
 * account. The recipient is always the account's own address, so this is not a
 * relay the way send-to-kindle was -- but a provider does not care who the
 * victim is when it decides the sending domain is a spam source, and the same
 * domain sends every password reset and verification link.
 *
 * Keyed on the account rather than the IP (the route is behind requireAuth,
 * so the better key exists), and sized for the feature: a digest is generated
 * once a day or once a week, so six sends an hour is already generous for
 * "I pressed it again because the first one hadn't arrived".
 */
const DIGEST_EMAIL_LIMIT = {
  max: Number(process.env.DIGEST_EMAIL_RATE_LIMIT_MAX) || 6,
  timeWindow: "1 hour",
  keyGenerator: (request: { userId: string | null; ip: string }) => request.userId ?? request.ip,
};

/** DAILY -> still the same calendar day; WEEKLY -> generated within the last 7 days. */
function isStillCurrent(generatedAt: Date, frequency: "DAILY" | "WEEKLY", now: Date): boolean {
  if (frequency === "WEEKLY") return now.getTime() - generatedAt.getTime() < 7 * DAY_MS;
  return generatedAt.toDateString() === now.toDateString();
}

export async function registerDigestRoutes(app: FastifyInstance): Promise<void> {
  /**
   * "Get me today's (or this week's) digest" -- generates one via the
   * resurfacing algorithm if the most recent one has expired per the user's
   * resurfaceFrequency, otherwise returns the existing one so a page reload
   * (or a second device) doesn't just re-roll a different random batch.
   */
  app.get("/api/digests/current", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId! } });
    const now = new Date();

    const latest = await prisma.digest.findFirst({
      where: { userId: user.id },
      orderBy: { generatedAt: "desc" },
      include: { highlights: { include: { annotation: true } } },
    });

    if (latest && isStillCurrent(latest.generatedAt, user.resurfaceFrequency, now)) {
      const body: Digest = {
        id: latest.id,
        userId: latest.userId,
        generatedAt: latest.generatedAt.toISOString(),
        viewedAt: latest.viewedAt?.toISOString() ?? null,
        emailSentAt: latest.emailSentAt?.toISOString() ?? null,
        highlights: latest.highlights.map(toHighlight),
      };
      if (!latest.viewedAt) {
        await prisma.digest.update({ where: { id: latest.id }, data: { viewedAt: now } });
      }
      return reply.send(body);
    }

    const selected = await getHighlightsToResurface(user.id, user.highlightsPerDigest);
    const created = await prisma.digest.create({
      data: {
        userId: user.id,
        viewedAt: now,
        highlights: { connect: selected.map((h) => ({ id: h.id })) },
      },
      include: { highlights: { include: { annotation: true } } },
    });

    const body: Digest = {
      id: created.id,
      userId: created.userId,
      generatedAt: created.generatedAt.toISOString(),
      viewedAt: created.viewedAt?.toISOString() ?? null,
      emailSentAt: created.emailSentAt?.toISOString() ?? null,
      highlights: created.highlights.map(toHighlight),
    };
    return reply.send(body);
  });

  app.post<{ Params: { id: string } }>(
    "/api/digests/:id/email",
    { preHandler: requireAuth, config: { rateLimit: DIGEST_EMAIL_LIMIT } },
    async (request, reply) => {
      const digest = await prisma.digest.findFirst({
        where: { id: request.params.id, userId: request.userId! },
        include: { highlights: { include: { annotation: true } } },
      });
      if (!digest) return reply.code(404).send({ error: "not_found", message: "Digest not found." });
      if (digest.highlights.length === 0) {
        return reply.code(400).send({ error: "empty_digest", message: "This digest has no highlights to send." });
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId! } });
      const articles = await prisma.article.findMany({
        where: { id: { in: [...new Set(digest.highlights.map((h) => h.articleId))] } },
        select: { id: true, title: true },
      });
      const articleTitleById = new Map(articles.map((a) => [a.id, { title: a.title }]));

      const content = compileDigestEmail(digest.highlights.map(toHighlight), articleTitleById);
      await sendEmail({ to: user.email, subject: content.subject, text: content.textBody });

      const updated = await prisma.digest.update({ where: { id: digest.id }, data: { emailSentAt: new Date() } });
      return reply.send({ ok: true, emailSentAt: updated.emailSentAt!.toISOString() });
    },
  );
}
