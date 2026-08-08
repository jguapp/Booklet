import type { FastifyInstance } from "fastify";
import type { CreateArticleRequest, CreateHighlightRequest } from "@booklet/shared";
import { canonicalizeUrl, isValidHighlightColor, isValidRecallPrompt, normalizeRecallPrompt } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { sanitizeArticleHtml } from "../lib/sanitize.js";
import { requireAuth, requireWriteScope } from "../lib/auth/context.js";
import { ExtractionError, fetchAndExtract } from "../services/extraction-service.js";
import { fireWebhookEvent } from "../services/webhook-service.js";
import { toArticle, toSummary } from "./articles.js";
import { isValidPosition, toHighlight } from "./highlights.js";
import { toCollection } from "./collections.js";

const LIST_PAGE_SIZE = 30;
// Distinct budget from the internal API's general 300/min -- a script or
// Zapier connection shouldn't be able to run up against (or exhaust) the
// same limit the web app's own UI relies on.
const V1_RATE_LIMIT = { max: 100, timeWindow: "1 minute" };

/**
 * The public, versioned surface for personal access tokens (see
 * lib/auth/api-token.ts) -- thin wrappers around the same Prisma queries
 * and toX() mappers the internal (unversioned, frontend-coupled) routes
 * already use, not a parallel reimplementation. Versioned separately from
 * /api/articles etc. because those are free to change shape alongside the
 * frontend; this needs its own stability contract so a frontend refactor
 * can't silently break someone's script.
 */
export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: requireAuth, config: { rateLimit: V1_RATE_LIMIT } };
  const writeOpts = { preHandler: [requireAuth, requireWriteScope], config: { rateLimit: V1_RATE_LIMIT } };

  app.get("/api/v1/articles", opts, async (request, reply) => {
    const { cursor } = request.query as { cursor?: string };
    const rows = await prisma.article.findMany({
      where: { userId: request.userId!, deletedAt: null },
      orderBy: [{ savedAt: "desc" }, { id: "desc" }],
      take: LIST_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > LIST_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;
    return reply.send({ articles: page.map(toSummary), nextCursor: hasMore ? page[page.length - 1].id : null });
  });

  app.get<{ Params: { id: string } }>("/api/v1/articles/:id", opts, async (request, reply) => {
    const article = await prisma.article.findFirst({
      where: { id: request.params.id, userId: request.userId!, deletedAt: null },
    });
    if (!article) return reply.code(404).send({ error: "not_found", message: "Article not found." });
    return reply.send(toArticle(article));
  });

  app.post<{ Body: CreateArticleRequest }>("/api/v1/articles", writeOpts, async (request, reply) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !url.trim()) {
      return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
    }

    const canonicalUrl = canonicalizeUrl(url);
    const existing = await prisma.article.findFirst({
      where: { userId: request.userId!, OR: [{ url }, ...(canonicalUrl ? [{ canonicalUrl }] : [])] },
    });
    if (existing) return reply.code(409).send({ error: "already_saved", message: "You've already saved this article." });

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
        canonicalUrl,
        title: extracted?.title ?? null,
        author: extracted?.author ?? null,
        siteName: extracted?.siteName ?? null,
        excerpt: extracted?.excerpt ?? null,
        sourceType: "HTML",
        extractionStatus: extracted ? "SUCCESS" : "FAILED",
        extractionError,
        // Sanitized before storage -- see routes/articles.ts.
        extractedHtml: sanitizeArticleHtml(extracted?.html),
        extractedText: extracted?.text ?? null,
        readingTimeEstimate: extracted?.readingTimeEstimate ?? null,
        skippedImageCount: extracted?.skippedImageCount ?? 0,
        coverImageUrl: extracted?.coverImageUrl ?? null,
      },
    });

    const body = toArticle(article);
    fireWebhookEvent(request.userId!, "article.created", { id: body.id, url: body.url, title: body.title }).catch(
      () => undefined,
    );
    return reply.code(201).send(body);
  });

  app.get("/api/v1/highlights", opts, async (request, reply) => {
    const { articleId } = request.query as { articleId?: string };
    const rows = await prisma.highlight.findMany({
      where: { userId: request.userId!, ...(articleId ? { articleId } : {}) },
      include: { annotation: true },
      orderBy: { createdAt: "desc" },
      take: LIST_PAGE_SIZE,
    });
    return reply.send(rows.map(toHighlight));
  });

  app.post<{ Body: CreateHighlightRequest }>("/api/v1/highlights", writeOpts, async (request, reply) => {
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

    const article = await prisma.article.findFirst({ where: { id: articleId, userId: request.userId! } });
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
        ...(trimmedNote ? { annotation: { create: { userId: request.userId!, noteText: trimmedNote } } } : {}),
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
  });

  app.get("/api/v1/collections", opts, async (request, reply) => {
    const rows = await prisma.collection.findMany({
      where: { userId: request.userId! },
      orderBy: { name: "asc" },
    });
    return reply.send(rows.map((r) => toCollection(r)));
  });
}
