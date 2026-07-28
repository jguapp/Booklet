import type { FastifyInstance } from "fastify";
import type { Digest, Highlight, HighlightPosition } from "@booklet/shared";
import { compileDigestEmail } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { getHighlightsToResurface } from "../services/resurface-service.js";
import { sendEmail } from "../services/email-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toHighlight(row: Awaited<ReturnType<typeof getHighlightsToResurface>>[number]): Highlight {
  return {
    id: row.id,
    articleId: row.articleId,
    userId: row.userId,
    selectedText: row.selectedText,
    position: row.position as unknown as HighlightPosition,
    color: row.color,
    lastSurfacedAt: row.lastSurfacedAt?.toISOString() ?? null,
    surfaceCount: row.surfaceCount,
    lastFeedback: row.lastFeedback,
    lastFeedbackAt: row.lastFeedbackAt?.toISOString() ?? null,
    resurfaceArchivedAt: row.resurfaceArchivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    annotation: row.annotation
      ? {
          id: row.annotation.id,
          highlightId: row.annotation.highlightId,
          userId: row.annotation.userId,
          noteText: row.annotation.noteText,
          createdAt: row.annotation.createdAt.toISOString(),
          updatedAt: row.annotation.updatedAt.toISOString(),
        }
      : null,
  };
}

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
    { preHandler: requireAuth },
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
