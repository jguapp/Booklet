import type { FastifyInstance } from "fastify";
import type {
  CreateHighlightRequest,
  Highlight,
  HighlightPosition,
  ResurfaceFeedback,
  UpdateHighlightRequest,
  UpsertAnnotationRequest,
} from "@booklet/shared";
import { isValidHighlightColor, isValidRecallPrompt, normalizeRecallPrompt } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { fireWebhookEvent } from "../services/webhook-service.js";

const FEEDBACKS: ResurfaceFeedback[] = ["REMEMBERED", "FORGOT"];

/**
 * Upper bounds on the SM-2 columns, which had none.
 *
 * The existing checks only reject the low end (>= 1.3, >= 0), so
 * `easinessFactor: 1.7976931348623157e308` and `intervalDays: 999999999999`
 * both passed validation and then failed at the driver -- Postgres refusing
 * an out-of-range double and an integer column that stops at 2^31-1 -- which
 * this route answers as a 500. A number a scheduling algorithm can never
 * produce is a bad request, not an internal error, and 500s are what page
 * someone at night.
 *
 * The values themselves are the far side of anything the algorithm reaches:
 * SM-2 raises the easiness factor by at most 0.1 per review, and an interval
 * of a century is already well past "you will never see this card again".
 */
const MAX_EASINESS_FACTOR = 10;
const MAX_INTERVAL_DAYS = 36_500;
/** Postgres `integer`, which is what surfaceCount and repetitions are. */
const MAX_INT32 = 2_147_483_647;

/**
 * A Date from an ISO-ish string, or null if it isn't one.
 *
 * `new Date("garbage")` is an Invalid Date, which survives every check up to
 * the driver and then throws there -- routes/sync.ts already guards its
 * import path for exactly this reason ("an unparseable date reads as NaN and
 * would throw at the driver"); this route did not, so four of its fields
 * turned any non-date string into a 500. Confirmed by injection on all four.
 */
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function findHighlightWithAnnotation(id: string) {
  return prisma.highlight.findUnique({ where: { id }, include: { annotation: true } });
}
export type HighlightRow = NonNullable<Awaited<ReturnType<typeof findHighlightWithAnnotation>>>;

export function toHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    articleId: row.articleId,
    userId: row.userId,
    selectedText: row.selectedText,
    position: row.position as unknown as HighlightPosition,
    color: row.color,
    prompt: row.prompt,
    lastSurfacedAt: row.lastSurfacedAt?.toISOString() ?? null,
    surfaceCount: row.surfaceCount,
    lastFeedback: row.lastFeedback,
    lastFeedbackAt: row.lastFeedbackAt?.toISOString() ?? null,
    resurfaceArchivedAt: row.resurfaceArchivedAt?.toISOString() ?? null,
    easinessFactor: row.easinessFactor,
    intervalDays: row.intervalDays,
    repetitions: row.repetitions,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
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

/** Shared with the public v1 routes, which validate the same body shape --
 * exported for the same reason toHighlight below is, so /api/v1/highlights
 * stays a wrapper over this module rather than a parallel copy of it. */
export function isValidPosition(value: unknown): value is HighlightPosition {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return type === "text" || type === "pdf" || type === "epub";
}

export async function registerHighlightRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateHighlightRequest }>(
    "/api/highlights",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { articleId, selectedText, position, color, noteText, prompt } = request.body ?? {};

      if (typeof articleId !== "string" || !articleId) {
        return reply.code(400).send({ error: "invalid_article", message: "articleId is required." });
      }
      if (typeof selectedText !== "string" || !selectedText) {
        return reply.code(400).send({ error: "invalid_text", message: "selectedText is required." });
      }
      if (!isValidPosition(position)) {
        return reply.code(400).send({ error: "invalid_position", message: "Invalid highlight position." });
      }
      if (typeof color !== "string" || !isValidHighlightColor(color)) {
        return reply.code(400).send({ error: "invalid_color", message: "Invalid highlight color." });
      }
      if (!isValidRecallPrompt(prompt)) {
        return reply.code(400).send({ error: "invalid_prompt", message: "Invalid recall prompt." });
      }

      const article = await prisma.article.findFirst({
        where: { id: articleId, userId: request.userId! },
      });
      if (!article) return reply.code(404).send({ error: "not_found", message: "Article not found." });

      const trimmedNote = noteText?.trim();
      const created = await prisma.highlight.create({
        data: {
          articleId,
          userId: request.userId!,
          selectedText,
          position: position as object,
          color,
          prompt: normalizeRecallPrompt(prompt),
          ...(trimmedNote
            ? { annotation: { create: { userId: request.userId!, noteText: trimmedNote } } }
            : {}),
        },
        include: { annotation: true },
      });

      const body = toHighlight(created);
      fireWebhookEvent(request.userId!, "highlight.created", {
        id: body.id,
        articleId: body.articleId,
        selectedText: body.selectedText,
      }).catch(() => undefined);
      return reply.code(201).send(body);
    },
  );

  app.get("/api/highlights", { preHandler: requireAuth }, async (request, reply) => {
    const { articleId } = request.query as { articleId?: string };

    const rows = await prisma.highlight.findMany({
      where: { userId: request.userId!, ...(articleId ? { articleId } : {}) },
      include: { annotation: true },
      orderBy: { createdAt: "asc" },
    });

    return reply.send(rows.map(toHighlight));
  });

  app.patch<{ Params: { id: string }; Body: UpdateHighlightRequest }>(
    "/api/highlights/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.highlight.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Highlight not found." });

      const {
        color,
        prompt,
        resurfaceArchivedAt,
        lastSurfacedAt,
        surfaceCount,
        lastFeedback,
        lastFeedbackAt,
        easinessFactor,
        intervalDays,
        repetitions,
        nextDueAt,
      } = request.body ?? {};

      if (color !== undefined && (typeof color !== "string" || !isValidHighlightColor(color))) {
        return reply.code(400).send({ error: "invalid_color", message: "Invalid highlight color." });
      }
      if (prompt !== undefined && !isValidRecallPrompt(prompt)) {
        return reply.code(400).send({ error: "invalid_prompt", message: "Invalid recall prompt." });
      }
      if (lastFeedback !== undefined && !FEEDBACKS.includes(lastFeedback)) {
        return reply.code(400).send({ error: "invalid_feedback", message: "Invalid feedback value." });
      }
      if (
        surfaceCount !== undefined &&
        (!Number.isInteger(surfaceCount) || surfaceCount < 0 || surfaceCount > MAX_INT32)
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_surface_count", message: "surfaceCount must be a non-negative integer." });
      }
      if (
        easinessFactor !== undefined &&
        (typeof easinessFactor !== "number" ||
          !Number.isFinite(easinessFactor) ||
          easinessFactor < 1.3 ||
          easinessFactor > MAX_EASINESS_FACTOR)
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_easiness_factor", message: `easinessFactor must be between 1.3 and ${MAX_EASINESS_FACTOR}.` });
      }
      if (
        intervalDays !== undefined &&
        (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > MAX_INTERVAL_DAYS)
      ) {
        return reply
          .code(400)
          .send({ error: "invalid_interval", message: `intervalDays must be an integer between 0 and ${MAX_INTERVAL_DAYS}.` });
      }
      if (repetitions !== undefined && (!Number.isInteger(repetitions) || repetitions < 0 || repetitions > MAX_INT32)) {
        return reply
          .code(400)
          .send({ error: "invalid_repetitions", message: "repetitions must be a non-negative integer." });
      }

      // Parsed up front so an unparseable date is a 400 naming the field,
      // rather than an Invalid Date carried down into the update and thrown
      // by the driver as a 500.
      const dates: Partial<Record<"resurfaceArchivedAt" | "lastSurfacedAt" | "lastFeedbackAt" | "nextDueAt", Date>> = {};
      for (const [field, value] of Object.entries({
        resurfaceArchivedAt,
        lastSurfacedAt,
        lastFeedbackAt,
        nextDueAt,
      }) as [keyof typeof dates, unknown][]) {
        // null is a value only resurfaceArchivedAt accepts (it clears the
        // archive), and the update below handles it directly.
        if (value === undefined || value === null) continue;
        const parsed = parseDate(value);
        if (!parsed) {
          return reply.code(400).send({ error: "invalid_date", message: `${field} must be an ISO date string.` });
        }
        dates[field] = parsed;
      }

      const updated = await prisma.highlight.update({
        where: { id: existing.id },
        data: {
          ...(color !== undefined ? { color } : {}),
          // A prompt of "" or "   " normalizes to null, so clearing one from
          // the UI works whether it sends null or an emptied textarea.
          ...(prompt !== undefined ? { prompt: normalizeRecallPrompt(prompt) } : {}),
          ...(resurfaceArchivedAt !== undefined
            ? { resurfaceArchivedAt: dates.resurfaceArchivedAt ?? null }
            : {}),
          ...(dates.lastSurfacedAt ? { lastSurfacedAt: dates.lastSurfacedAt } : {}),
          ...(surfaceCount !== undefined ? { surfaceCount } : {}),
          ...(lastFeedback !== undefined ? { lastFeedback } : {}),
          ...(dates.lastFeedbackAt ? { lastFeedbackAt: dates.lastFeedbackAt } : {}),
          ...(easinessFactor !== undefined ? { easinessFactor } : {}),
          ...(intervalDays !== undefined ? { intervalDays } : {}),
          ...(repetitions !== undefined ? { repetitions } : {}),
          ...(dates.nextDueAt ? { nextDueAt: dates.nextDueAt } : {}),
        },
        include: { annotation: true },
      });

      return reply.send(toHighlight(updated));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/highlights/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.highlight.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Highlight not found." });
      await prisma.highlight.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string }; Body: UpsertAnnotationRequest }>(
    "/api/highlights/:id/annotation",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.highlight.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Highlight not found." });

      const noteText = request.body?.noteText?.trim();
      if (!noteText) {
        return reply.code(400).send({ error: "invalid_note", message: "noteText is required." });
      }

      await prisma.annotation.upsert({
        where: { highlightId: existing.id },
        create: { highlightId: existing.id, userId: request.userId!, noteText },
        update: { noteText },
      });

      const updated = await findHighlightWithAnnotation(existing.id);
      return reply.send(toHighlight(updated!));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/highlights/:id/annotation",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.highlight.findFirst({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Highlight not found." });

      await prisma.annotation.deleteMany({ where: { highlightId: existing.id } });

      const updated = await findHighlightWithAnnotation(existing.id);
      return reply.send(toHighlight(updated!));
    },
  );
}
