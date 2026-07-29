import type { FastifyInstance } from "fastify";
import type {
  CreateHighlightRequest,
  Highlight,
  HighlightColor,
  HighlightPosition,
  ResurfaceFeedback,
  UpdateHighlightRequest,
  UpsertAnnotationRequest,
} from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";

const COLORS: HighlightColor[] = ["YELLOW", "GREEN", "BLUE", "PINK", "ORANGE"];
const FEEDBACKS: ResurfaceFeedback[] = ["REMEMBERED", "FORGOT"];

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

function isValidPosition(value: unknown): value is HighlightPosition {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return type === "text" || type === "pdf" || type === "epub";
}

export async function registerHighlightRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateHighlightRequest }>(
    "/api/highlights",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { articleId, selectedText, position, color, noteText } = request.body ?? {};

      if (typeof articleId !== "string" || !articleId) {
        return reply.code(400).send({ error: "invalid_article", message: "articleId is required." });
      }
      if (typeof selectedText !== "string" || !selectedText) {
        return reply.code(400).send({ error: "invalid_text", message: "selectedText is required." });
      }
      if (!isValidPosition(position)) {
        return reply.code(400).send({ error: "invalid_position", message: "Invalid highlight position." });
      }
      if (!COLORS.includes(color)) {
        return reply.code(400).send({ error: "invalid_color", message: "Invalid highlight color." });
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
          ...(trimmedNote
            ? { annotation: { create: { userId: request.userId!, noteText: trimmedNote } } }
            : {}),
        },
        include: { annotation: true },
      });

      return reply.code(201).send(toHighlight(created));
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

      if (color !== undefined && !COLORS.includes(color)) {
        return reply.code(400).send({ error: "invalid_color", message: "Invalid highlight color." });
      }
      if (lastFeedback !== undefined && !FEEDBACKS.includes(lastFeedback)) {
        return reply.code(400).send({ error: "invalid_feedback", message: "Invalid feedback value." });
      }
      if (surfaceCount !== undefined && (!Number.isInteger(surfaceCount) || surfaceCount < 0)) {
        return reply.code(400).send({ error: "invalid_surface_count", message: "surfaceCount must be a non-negative integer." });
      }
      if (easinessFactor !== undefined && (typeof easinessFactor !== "number" || easinessFactor < 1.3)) {
        return reply.code(400).send({ error: "invalid_easiness_factor", message: "easinessFactor must be >= 1.3." });
      }
      if (intervalDays !== undefined && (!Number.isInteger(intervalDays) || intervalDays < 0)) {
        return reply.code(400).send({ error: "invalid_interval", message: "intervalDays must be a non-negative integer." });
      }
      if (repetitions !== undefined && (!Number.isInteger(repetitions) || repetitions < 0)) {
        return reply.code(400).send({ error: "invalid_repetitions", message: "repetitions must be a non-negative integer." });
      }

      const updated = await prisma.highlight.update({
        where: { id: existing.id },
        data: {
          ...(color !== undefined ? { color } : {}),
          ...(resurfaceArchivedAt !== undefined
            ? { resurfaceArchivedAt: resurfaceArchivedAt ? new Date(resurfaceArchivedAt) : null }
            : {}),
          ...(lastSurfacedAt !== undefined ? { lastSurfacedAt: new Date(lastSurfacedAt) } : {}),
          ...(surfaceCount !== undefined ? { surfaceCount } : {}),
          ...(lastFeedback !== undefined ? { lastFeedback } : {}),
          ...(lastFeedbackAt !== undefined ? { lastFeedbackAt: new Date(lastFeedbackAt) } : {}),
          ...(easinessFactor !== undefined ? { easinessFactor } : {}),
          ...(intervalDays !== undefined ? { intervalDays } : {}),
          ...(repetitions !== undefined ? { repetitions } : {}),
          ...(nextDueAt !== undefined ? { nextDueAt: new Date(nextDueAt) } : {}),
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
