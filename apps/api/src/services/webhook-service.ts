import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export type WebhookEvent = "article.created" | "highlight.created";

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Fire-and-forget from the caller's point of view -- article/highlight
 * creation shouldn't wait on (or fail because of) some third-party
 * endpoint being slow or down. Every attempt, success or failure, gets a
 * WebhookDelivery row so a user can actually see what happened instead of
 * a webhook silently going quiet forever (see the model's own comment).
 * At-least-once, no retry queue yet -- a receiving endpoint being briefly
 * down loses that one delivery rather than retrying later; a real retry-
 * with-backoff is a reasonable follow-up once this sees real usage.
 */
export async function fireWebhookEvent(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: { userId, active: true, events: { has: event } },
  });
  if (webhooks.length === 0) return;

  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  await Promise.all(
    webhooks.map(async (webhook) => {
      const signature = signPayload(webhook.secret, body);
      let statusCode: number | null = null;
      let success = false;
      let error: string | null = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(webhook.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Booklet-Signature": signature, "X-Booklet-Event": event },
            body,
            signal: controller.signal,
          });
          statusCode = res.status;
          success = res.ok;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : "Request failed.";
      }

      await prisma.webhookDelivery.create({
        data: { webhookId: webhook.id, event, statusCode, success, error },
      });
    }),
  );
}
