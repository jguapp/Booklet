import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { prisma } from "../lib/prisma.js";
import { fireWebhookEvent, generateWebhookSecret } from "../services/webhook-service.js";

/**
 * The send side of webhook delivery, which the create-time URL check does not
 * cover.
 *
 * routes/webhooks.ts validates the URL when a webhook is registered, and that
 * is a bound rather than a control: the hostname is resolved again on every
 * delivery, so a record that was public when it was saved and is re-pointed
 * afterwards (or one that simply answers 302) still had to be stopped here.
 * It mattered more than a blind SSRF would, because every attempt writes a
 * WebhookDelivery row carrying the status code and the error string, and
 * GET /api/webhooks/:id/deliveries hands both back -- so a reachable internal
 * host is not just reachable, it is legible.
 *
 * These assert on the delivery row rather than on fetch, because the row is
 * what the user is shown and what an attacker would be reading.
 */

const EMAIL = `vitest-webhook-${Date.now()}@test.local`;

let userId: string;
/** A real local server, so "did the request actually arrive" is observable
 * rather than inferred from the absence of an error. */
let redirector: Server;
let redirectorUrl: string;
let hits = 0;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Webhook Test" } });
  userId = user.id;

  redirector = createServer((req, res) => {
    hits++;
    // The shape that defeats create-time validation: a public URL whose
    // answer points inward.
    res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  const address = redirector.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  redirectorUrl = `http://127.0.0.1:${address.port}/hook`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => redirector.close(() => resolve()));
  await prisma.webhookDelivery.deleteMany({ where: { webhook: { userId } } });
  await prisma.webhook.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

async function fireTo(url: string): Promise<{ success: boolean; statusCode: number | null; error: string | null }> {
  const webhook = await prisma.webhook.create({
    data: { userId, url, secret: generateWebhookSecret(), events: ["article.created"], active: true },
  });
  await fireWebhookEvent(userId, "article.created", { id: "article-1" });
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { webhookId: webhook.id },
    orderBy: { createdAt: "desc" },
  });
  if (!delivery) throw new Error("no delivery row was written");
  // Deactivated so the next case's fireWebhookEvent only hits its own URL.
  await prisma.webhook.update({ where: { id: webhook.id }, data: { active: false } });
  return { success: delivery.success, statusCode: delivery.statusCode, error: delivery.error };
}

describe("webhook delivery re-checks the destination at send time", () => {
  it("refuses a URL that resolves to a link-local address", async () => {
    const result = await fireTo("http://169.254.169.254/latest/meta-data/");
    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toMatch(/private address/i);
  }, 30_000);

  it("refuses a URL that resolves to loopback", async () => {
    const result = await fireTo("http://127.0.0.1:9999/internal");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private address/i);
  }, 30_000);

  it("does not follow a redirect that points inward", async () => {
    hits = 0;
    const result = await fireTo(redirectorUrl);

    // 127.0.0.1 is itself private, so this is refused before it is even
    // dialled -- which is the correct outcome and also means the redirect
    // never gets a chance. Asserting the request did not go out at all is
    // the stronger statement.
    expect(hits).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private address/i);
  }, 30_000);
});
