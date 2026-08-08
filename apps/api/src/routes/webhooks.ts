import type { FastifyInstance } from "fastify";
import type { CreateWebhookRequest, Webhook, WebhookDeliverySummary } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { checkPublicHost } from "../lib/private-address.js";
import { generateWebhookSecret } from "../services/webhook-service.js";

const VALID_EVENTS = ["article.created", "highlight.created"];
const DELIVERY_HISTORY_LIMIT = 20;

/**
 * Whether a webhook URL may be registered.
 *
 * A webhook is SSRF by design -- the whole feature is "this server will make
 * an HTTP request to an address you choose" -- so the only question is what
 * bounds it, and until this existed the answer was nothing but a scheme
 * check. Confirmed by injection: `https://169.254.169.254/latest/meta-data/`,
 * `https://10.0.0.5/internal` and `https://[::1]:9999/` were all accepted
 * with 201. On any cloud host the first of those is the instance metadata
 * service, and the delivery log makes it a usable oracle rather than a blind
 * one: GET /api/webhooks/:id/deliveries returns the status code and the
 * fetch's error string for every attempt, which is enough to map an internal
 * network and find which ports answer. Deliveries are POSTs with a JSON body,
 * so an internal service that acts on unauthenticated POSTs acts on this one.
 *
 * The loopback allowance stays for the two hostnames it named, but only off
 * production. Pointing a webhook at your own dev server is the reason it was
 * written, and there is no private network reachable from a developer's
 * laptop that they could not reach directly; on a deployed instance the same
 * allowance is a request to every service sharing that host.
 *
 * Returns a message rather than throwing so the caller can answer 400 with
 * wording that says which rule was broken.
 */
export async function checkWebhookUrl(
  raw: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "That's not a valid URL." };
  }

  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLoopback && nodeEnv !== "production") {
    // http:// too -- there is no eavesdropper between a machine and itself,
    // and a locally-trusted cert is friction rather than a security win.
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? { ok: true }
      : { ok: false, message: "Webhook URLs must use https://." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Webhook URLs must use https://." };
  }

  // Same resolver-level check article extraction and feed fetching already
  // use, so a hostname that merely *resolves* to a private address is caught
  // too -- `https://internal.corp.example` and a DNS record pointing at
  // 10.0.0.5 are the same request.
  const host = await checkPublicHost(parsed.hostname);
  if (!host.ok) {
    return {
      ok: false,
      message:
        host.reason === "unresolvable"
          ? "That host can't be resolved."
          : "Webhook URLs must point at a public address.",
    };
  }

  return { ok: true };
}

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
      const checked = await checkWebhookUrl(url);
      if (!checked.ok) return reply.code(400).send({ error: "invalid_url", message: checked.message });
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
