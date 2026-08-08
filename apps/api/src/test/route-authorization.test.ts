import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { checkWebhookUrl } from "../routes/webhooks.js";
import { deleteStoredFile, saveFile } from "../services/storage-service.js";

/**
 * The authorization boundaries the route layer is supposed to hold, each one
 * written against a way it was found not to.
 *
 * Every case here failed before the fix it accompanies -- these are not
 * regression tests for hypotheticals. What they have in common is that the
 * check was present *somewhere*: the write scope existed but only on
 * /api/v1, the parent-ownership check existed but only on PATCH, the SSRF
 * guard existed but only for extraction and feeds. A control applied to one
 * of two paths is the shape this file is looking for.
 */

const OWNER = `vitest-authz-owner-${Date.now()}@test.local`;
const STRANGER = `vitest-authz-stranger-${Date.now()}@test.local`;
const PASSWORD = "hunter22222";

let app: FastifyInstance;
let ownerToken: string;
let strangerToken: string;
let ownerId: string;

async function signUp(email: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { email, password: PASSWORD } });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  return { token: body.accessToken, id: body.user.id };
}

async function mintPat(scopes: string[]): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: `test-${scopes.join("-")}`, scopes },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token;
}

async function makeBook(token: string, title: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/articles/book",
    headers: { authorization: `Bearer ${token}` },
    payload: { title },
  });
  return res.json().id;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  ({ token: ownerToken, id: ownerId } = await signUp(OWNER));
  ({ token: strangerToken } = await signUp(STRANGER));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  await app.close();
});

describe("personal access tokens are confined to /api/v1", () => {
  it("a read-only token cannot write through the internal API", async () => {
    const pat = await mintPat(["read"]);
    const articleId = await makeBook(ownerToken, "confinement subject");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${pat}` },
      payload: { title: "renamed by a read-only token" },
    });
    expect(patch.statusCode).toBe(401);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(remove.statusCode).toBe(401);

    // The article is untouched, not merely un-renamed.
    const still = await prisma.article.findUnique({ where: { id: articleId } });
    expect(still?.title).toBe("confinement subject");
  });

  /**
   * The escalation that makes revocation meaningless: a token that can mint
   * a token cannot be revoked, because revoking it leaves behind whatever it
   * created. Both of these returned 201 before the confinement.
   */
  it("no token, at any scope, can mint another credential", async () => {
    for (const pat of [await mintPat(["read"]), await mintPat(["read", "write"])]) {
      const anotherPat = await app.inject({
        method: "POST",
        url: "/api/tokens",
        headers: { authorization: `Bearer ${pat}` },
        payload: { name: "escalated", scopes: ["read", "write"] },
      });
      expect(anotherPat.statusCode).toBe(401);

      // A feed URL is a bearer credential for the audio of the whole library.
      const feed = await app.inject({
        method: "POST",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${pat}` },
      });
      expect(feed.statusCode).toBe(401);
    }
    expect(await prisma.apiToken.count({ where: { userId: ownerId, name: "escalated" } })).toBe(0);
  });

  it("no token can delete the account or touch its sessions", async () => {
    const pat = await mintPat(["read", "write"]);

    const del = await app.inject({
      method: "DELETE",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${pat}` },
      payload: { password: PASSWORD },
    });
    expect(del.statusCode).toBe(401);
    expect(await prisma.user.findUnique({ where: { id: ownerId } })).not.toBeNull();

    const sessions = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/revoke-others",
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(sessions.statusCode).toBe(401);
  });

  it("still works for what it is for -- reading and writing /api/v1", async () => {
    const readWrite = await mintPat(["read", "write"]);
    const readOnly = await mintPat(["read"]);
    const articleId = await makeBook(ownerToken, "v1 subject");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/articles",
      headers: { authorization: `Bearer ${readOnly}` },
    });
    expect(list.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/highlights",
      headers: { authorization: `Bearer ${readWrite}` },
      payload: { articleId, selectedText: "a passage", position: { type: "text" }, color: "YELLOW" },
    });
    expect(write.statusCode).toBe(201);

    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/highlights",
      headers: { authorization: `Bearer ${readOnly}` },
      payload: { articleId, selectedText: "another", position: { type: "text" }, color: "YELLOW" },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("insufficient_scope");
  });

  it("leaves an anonymous-capable route anonymous rather than 401ing it", async () => {
    // The confinement must not turn "extra header the route doesn't need"
    // into a refusal -- /api/extract serves callers with no account at all.
    const pat = await mintPat(["read"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/extract",
      headers: { authorization: `Bearer ${pat}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_url");
  });
});

describe("webhook delivery URLs cannot point inward", () => {
  it("refuses private, loopback and link-local targets", async () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/", // cloud instance metadata
      "https://10.0.0.5/internal",
      "https://192.168.1.1/admin",
      "https://[::1]:9999/x",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/webhooks",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { url, events: ["article.created"] },
      });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error, url).toBe("invalid_url");
    }
    expect(await prisma.webhook.count({ where: { userId: ownerId } })).toBe(0);
  });

  it("allows loopback only off production", async () => {
    // Pointing a webhook at your own dev server is the reason the exemption
    // exists; on a deployed instance it is a request to every service
    // sharing that host.
    expect(await checkWebhookUrl("http://localhost:9999/hook", "development")).toEqual({ ok: true });
    expect((await checkWebhookUrl("http://localhost:9999/hook", "production")).ok).toBe(false);
    expect((await checkWebhookUrl("https://127.0.0.1/hook", "production")).ok).toBe(false);
  });

  it("still accepts an ordinary public https endpoint", async () => {
    expect(await checkWebhookUrl("https://example.com/hook", "production")).toEqual({ ok: true });
  });
});

describe("collections", () => {
  it("cannot be created under another account's collection", async () => {
    const theirs = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { name: "not yours" },
    });
    const theirId = theirs.json().id as string;

    const mine = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "child of a stranger", parentId: theirId },
    });
    expect(mine.statusCode).toBe(404);
    expect(await prisma.collection.count({ where: { parentId: theirId } })).toBe(0);
  });

  /**
   * The filter is stored and re-evaluated on every later read, so a shape
   * Prisma cannot use is not one bad request -- it is a collection that 500s
   * forever, including through the memberships endpoint the library page
   * loads for the whole account.
   */
  it("refuses a smart-collection filter that is not a filter", async () => {
    for (const filter of [
      { status: { not: "UNREAD" } },
      { textQuery: { contains: "x" } },
      { tags: [{ has: "x" }] },
      { favorited: "yes" },
      { userId: "someone-else" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/collections",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: `filter-${JSON.stringify(filter).slice(0, 20)}`, filter },
      });
      expect(res.statusCode, JSON.stringify(filter)).toBe(400);
    }

    // The library page's own query still answers.
    const memberships = await app.inject({
      method: "GET",
      url: "/api/articles/collection-memberships",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(memberships.statusCode).toBe(200);
  });

  it("still creates a real smart collection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "unread and tagged", filter: { status: "UNREAD", tags: ["later"], favorited: true } },
    });
    expect(res.statusCode).toBe(201);
    const articles = await app.inject({
      method: "GET",
      url: `/api/collections/${res.json().id}/articles`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(articles.statusCode).toBe(200);
  });

  it("answers the same way for a parent that exists elsewhere and one that exists nowhere", async () => {
    // Otherwise the difference (201 vs. the FK constraint's 500) is an
    // existence oracle for any collection id in the database.
    const theirs = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { name: "oracle target" },
    });
    const real = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "probe-a", parentId: theirs.json().id },
    });
    const imaginary = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "probe-b", parentId: "clnonexistent000000000000" },
    });
    expect(imaginary.statusCode).toBe(real.statusCode);
    expect(imaginary.json()).toEqual(real.json());
  });
});

describe("highlight updates reject what the driver would have thrown on", () => {
  let highlightId: string;

  beforeAll(async () => {
    const articleId = await makeBook(ownerToken, "sm-2 subject");
    const res = await app.inject({
      method: "POST",
      url: "/api/highlights",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { articleId, selectedText: "a passage", position: { type: "text" }, color: "YELLOW" },
    });
    highlightId = res.json().id;
  });

  it("400s rather than 500s on unparseable dates and out-of-range numbers", async () => {
    for (const payload of [
      { nextDueAt: "not-a-date" },
      { lastSurfacedAt: "garbage" },
      { lastFeedbackAt: "" },
      { resurfaceArchivedAt: "xyz" },
      { easinessFactor: Number.MAX_VALUE },
      { intervalDays: 999_999_999_999 },
      { repetitions: 999_999_999_999 },
      { surfaceCount: 999_999_999_999 },
    ]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/highlights/${highlightId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("still accepts the values the scheduler actually produces", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/highlights/${highlightId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        easinessFactor: 2.6,
        intervalDays: 6,
        repetitions: 2,
        surfaceCount: 3,
        nextDueAt: new Date("2030-01-01T00:00:00.000Z").toISOString(),
        lastSurfacedAt: new Date("2029-12-26T00:00:00.000Z").toISOString(),
        resurfaceArchivedAt: null,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().intervalDays).toBe(6);
    expect(res.json().resurfaceArchivedAt).toBeNull();
  });
});

describe("downloading an uploaded file", () => {
  /**
   * Not an injection test in the end -- Node refuses to write a header
   * containing CRLF or a character outside latin-1. The bug is what that
   * refusal costs: the throw lands after reply.hijack(), so nothing can send
   * a response and the socket is held open with no reply at all.
   */
  it("answers for filenames Node cannot put in a header verbatim", async () => {
    for (const filename of ["日本語のほん.pdf", "emoji-📕.pdf", 'evil"\r\nX-Injected: yes\r\n\r\n.pdf']) {
      const article = await prisma.article.create({
        data: { userId: ownerId, title: filename, sourceType: "PDF", fileStorageKey: "gone/key.pdf", originalFilename: filename },
      });

      const answered = await Promise.race([
        app
          .inject({
            method: "GET",
            url: `/api/articles/${article.id}/file`,
            headers: { authorization: `Bearer ${ownerToken}` },
          })
          .then(() => "responded")
          // The stored file genuinely does not exist here, so the stream
          // errors and the socket is destroyed -- that is a response having
          // been attempted, which is the thing being asserted.
          .catch(() => "responded"),
        new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
      ]);
      expect(answered, filename).toBe("responded");
    }
  }, 20_000);

  it("sends both a plain-ASCII filename and the real one", async () => {
    const storageKey = await saveFile(ownerId, "日本語のほん.pdf", Buffer.from("%PDF-1.4 not really"));
    const article = await prisma.article.create({
      data: {
        userId: ownerId,
        title: "readable",
        sourceType: "PDF",
        fileStorageKey: storageKey,
        originalFilename: "日本語のほん.pdf",
      },
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/articles/${article.id}/file`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(res.statusCode).toBe(200);
      const disposition = res.headers["content-disposition"] as string;
      // The ASCII fallback for clients that cannot read RFC 5987, and the
      // real name for those that can -- a browser saving this gets the
      // Japanese filename back.
      expect(disposition).toContain('filename="');
      expect(disposition).toContain("filename*=UTF-8''");
      expect(disposition).toContain(encodeURIComponent("日本語のほん.pdf"));
    } finally {
      await deleteStoredFile(storageKey);
    }
  });
});

describe("send to Kindle is not a mail relay", () => {
  it("refuses a recipient that is not an Amazon address", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { kindleEmail: "victim@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_kindle_email");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).kindleEmail).toBeNull();
  });

  it("accepts the addresses Amazon actually hands out", async () => {
    for (const kindleEmail of ["you_abc123@kindle.com", "you_abc123@free.kindle.com", "YOU@Kindle.com"]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { kindleEmail },
      });
      expect(res.statusCode, kindleEmail).toBe(200);
    }
  });

  it("refuses to send to an address stored before that rule existed", async () => {
    // The check has to live where the mail is sent, not only where the
    // setting is written -- nothing rewrites rows that are already there.
    await prisma.user.update({ where: { id: ownerId }, data: { kindleEmail: "victim@example.com" } });
    const articleId = await makeBook(ownerToken, "payload");
    await prisma.article.update({ where: { id: articleId }, data: { extractedText: "body" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/articles/${articleId}/send-to-kindle`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_kindle_email");
  });

  /**
   * A rate limit that does not fire is worse than none, because it reads as
   * one. This drives the real limiter rather than asserting on the config
   * object -- in particular it is the only thing that would catch a
   * keyGenerator that returns undefined and makes every caller share one
   * bucket, or none.
   */
  it("stops one account sending mail without limit", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { kindleEmail: "you_abc123@kindle.com" } });
    const articleId = await makeBook(ownerToken, "rate limit subject");
    await prisma.article.update({ where: { id: articleId }, data: { extractedText: "body" } });

    const codes: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/api/articles/${articleId}/send-to-kindle`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      codes.push(res.statusCode);
      if (res.statusCode === 429) break;
    }
    expect(codes).toContain(429);
  }, 30_000);

});
