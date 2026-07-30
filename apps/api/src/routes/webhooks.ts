import type { FastifyInstance } from "fastify";
import type { CreateWebhookRequest, Webhook, WebhookDeliverySummary } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { generateWebhookSecret } from "../services/webhook-service.js";

const VALID_EVENTS = ["article.created", "highlight.created"];
const DELIVERY_HISTORY_LIMIT = 20;

function toWebhook(row: { id: string; url: string; events: string[]; active: boolean; createdAt: Date }): Webhook {
  return { id: row.id, url: row.url, events: row.events, active: row.active, createdAt: row.createdAt.toISOString() };
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateWebhookRequest }>(
    "/api/webhooks",
    { preHandler: requireAuth },
    async (request, reply) => {
      const url = request.body?.url?.trim();
      const events = request.body?.events ?? [];
      if (!url) return reply.code(400).send({ error: "invalid_url", message: "A URL is required." });
      try {
        const parsed = new URL(url);
        // localhost/127.0.0.1 are exempt from the https:// requirement --
        // there's no meaningful network eavesdropper between a machine and
        // itself, and requiring a locally-trusted cert just to point a
        // webhook at your own dev server during testing isn't a real
        // security win, only friction.
        const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
          return reply.code(400).send({ error: "invalid_url", message: "Webhook URLs must use https://." });
        }
      } catch {
        return reply.code(400).send({ error: "invalid_url", message: "That's not a valid URL." });
      }
      if (events.length === 0 || !events.every((e) => VALID_EVENTS.includes(e))) {
        return reply
          .code(400)
          .send({ error: "invalid_events", message: `events must be a non-empty subset of ${VALID_EVENTS.join(", ")}.` });
      }

      const created = await prisma.webhook.create({
        data: { userId: request.userId!, url, events, secret: generateWebhookSecret() },
      });
      return reply.code(201).send(toWebhook(created));
    },
  );

  app.get("/api/webhooks", { preHandler: requireAuth }, async (request, reply) => {
    const rows = await prisma.webhook.findMany({ where: { userId: request.userId! }, orderBy: { createdAt: "desc" } });
    return reply.send(rows.map(toWebhook));
  });

  app.delete<{ Params: { id: string } }>(
    "/api/webhooks/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.webhook.findFirst({ where: { id: request.params.id, userId: request.userId! } });
      if (!existing) return reply.code(404).send({ error: "not_found", message: "Webhook not found." });
      await prisma.webhook.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/webhooks/:id/deliveries",
    { preHandler: requireAuth },
    async (request, reply) => {
      const webhook = await prisma.webhook.findFirst({ where: { id: request.params.id, userId: request.userId! } });
      if (!webhook) return reply.code(404).send({ error: "not_found", message: "Webhook not found." });

      const rows = await prisma.webhookDelivery.findMany({
        where: { webhookId: webhook.id },
        orderBy: { createdAt: "desc" },
        take: DELIVERY_HISTORY_LIMIT,
      });
      const body: WebhookDeliverySummary[] = rows.map((r) => ({
        id: r.id,
        event: r.event,
        statusCode: r.statusCode,
        success: r.success,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      }));
      return reply.send(body);
    },
  );
}
