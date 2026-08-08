import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { checkPublicHost } from "../lib/private-address.js";

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
        const target = new URL(webhook.url);

        // Re-checked here, at send time, and not only where the webhook was
        // registered. Validating on create is a bound, not a control: the
        // hostname is resolved again for every delivery, so a record that
        // pointed somewhere public when it was saved and is re-pointed at
        // 169.254.169.254 afterwards would otherwise be fetched happily. The
        // delivery row keeps the status code and the error string, and
        // GET /api/webhooks/:id/deliveries hands both back -- which makes
        // this an oracle rather than a blind SSRF, so the send side has to
        // hold on its own.
        const host = await checkPublicHost(target.hostname);
        if (!host.ok) {
          throw new Error(
            host.reason === "private"
              ? "Refusing to deliver: that URL resolves to a private address."
              : "Refusing to deliver: that hostname could not be resolved.",
          );
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(target, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Booklet-Signature": signature, "X-Booklet-Event": event },
            body,
            signal: controller.signal,
            // Not followed, rather than followed-and-re-checked the way
            // extraction and RSS do it. Those are GETs of public documents;
            // this is a signed POST, and replaying it to a redirect target
            // would hand that target both the payload and a valid
            // X-Booklet-Signature for it -- so a 302 becomes a way to have
            // this server vouch for a body to a host the user never
            // registered. A webhook endpoint is a fixed URL by definition,
            // so a redirect is reported as the misconfiguration it is.
            redirect: "manual",
          });
          statusCode = res.status;
          // A redirect is not a delivery. Left out of `success` explicitly:
          // fetch reports an opaque redirect as ok === false already, but
          // relying on that would make this depend on a detail of how the
          // runtime models manual redirects.
          if (res.status >= 300 && res.status < 400) {
            error = `Endpoint redirected (${res.status}); webhook URLs must be final destinations.`;
            success = false;
          } else {
            success = res.ok;
          }
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
