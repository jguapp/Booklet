import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const OWNER_EMAIL = `vitest-share-owner-${Date.now()}@test.local`;
const STRANGER_EMAIL = `vitest-share-stranger-${Date.now()}@test.local`;
const PASSWORD = "hunter22222";

/** Text that must never appear on a public page: the article body is the
 * copyrighted part, and the "PRIVATE" markers make an accidental leak
 * obvious in a diff of the response rather than something you have to go
 * looking for. */
const ARTICLE_BODY = "PRIVATE-EXTRACTED-BODY the full text of the article, which is not ours to republish.";
const PRIVATE_ARTICLE_TITLE = "PRIVATE-OTHER-ARTICLE";

/** Every key that must not appear anywhere in a public response, at any
 * depth. Names rather than a shape assertion, because the failure this
 * guards against is someone spreading a Prisma row into the payload -- which
 * adds keys nobody wrote down, and which a "has the right fields" test would
 * happily pass. */
const FORBIDDEN_KEYS = [
  "userId",
  "user",
  "email",
  "name",
  "id",
  "extractedText",
  "extractedHtml",
  "excerpt",
  "coverImageUrl",
  "tags",
  "status",
  "progressFraction",
  "readingTimeEstimate",
  "activeReadingSeconds",
  "fileStorageKey",
  "savedAt",
  "viewCount",
  "slug",
  "articleId",
  "collectionId",
  "createdAt",
  "updatedAt",
  "deletedAt",
];

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

describe("public sharing (#158 part 1)", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let ownerId: string;
  let strangerToken: string;
  let articleId: string;
  let otherArticleId: string;
  let collectionId: string;
  let smartCollectionId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const ownerRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: OWNER_EMAIL, password: PASSWORD, name: "Share Owner" },
    });
    ownerToken = ownerRes.json().accessToken;
    ownerId = ownerRes.json().user.id;

    const strangerRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: STRANGER_EMAIL, password: PASSWORD },
    });
    strangerToken = strangerRes.json().accessToken;

    const article = await prisma.article.create({
      data: {
        userId: ownerId,
        url: "https://example.com/shared-essay",
        title: "A Shared Essay",
        author: "A. Writer",
        siteName: "Example",
        excerpt: "PRIVATE-PUBLISHER-EXCERPT",
        coverImageUrl: "data:image/png;base64,PRIVATE-COVER",
        extractedText: ARTICLE_BODY,
        extractedHtml: `<p>${ARTICLE_BODY}</p>`,
        tags: ["private-tag"],
      },
    });
    articleId = article.id;

    await prisma.highlight.create({
      data: {
        articleId,
        userId: ownerId,
        selectedText: "The first passage the owner chose to keep.",
        position: { type: "text" },
        color: "YELLOW",
        annotation: { create: { userId: ownerId, noteText: "Why this mattered to me." } },
      },
    });
    await prisma.highlight.create({
      data: {
        articleId,
        userId: ownerId,
        selectedText: "A second passage, kept for later.",
        position: { type: "text" },
        color: "GREEN",
      },
    });

    const otherArticle = await prisma.article.create({
      data: { userId: ownerId, url: "https://example.com/private", title: PRIVATE_ARTICLE_TITLE },
    });
    otherArticleId = otherArticle.id;
    await prisma.highlight.create({
      data: {
        articleId: otherArticleId,
        userId: ownerId,
        selectedText: "PRIVATE-OTHER-HIGHLIGHT",
        position: { type: "text" },
        color: "BLUE",
      },
    });

    const collection = await prisma.collection.create({ data: { userId: ownerId, name: "Reading Notes" } });
    collectionId = collection.id;
    await prisma.articleCollection.create({ data: { collectionId, articleId } });

    const smart = await prisma.collection.create({
      data: { userId: ownerId, name: "Smart Unread", filter: { status: "UNREAD" } },
    });
    smartCollectionId = smart.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, STRANGER_EMAIL] } } });
    await app.close();
  });

  describe("creating and listing", () => {
    it("refuses to share without a session", async () => {
      const res = await app.inject({ method: "POST", url: "/api/shares", payload: { articleId } });
      expect(res.statusCode).toBe(401);
    });

    it("refuses zero or two targets", async () => {
      const neither = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {},
      });
      expect(neither.statusCode).toBe(400);

      const both = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId, collectionId },
      });
      expect(both.statusCode).toBe(400);
    });

    it("refuses to share someone else's article", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${strangerToken}` },
        payload: { articleId },
      });
      expect(res.statusCode).toBe(404);
    });

    it("refuses to share a smart collection, whose membership would keep changing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { collectionId: smartCollectionId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("smart_collection");
    });

    it("mints an unguessable slug and reuses it when re-shared", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId },
      });
      expect(res.statusCode).toBe(201);
      const share = res.json();
      expect(share.targetType).toBe("article");

      // 16 random bytes, base64url -- 22 characters, no padding. Asserted
      // because the slug is the only access control on the page, so a
      // shortened one is a silent downgrade of the whole feature.
      expect(share.slug).toMatch(/^[A-Za-z0-9_-]{22}$/);

      const again = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId },
      });
      // A second live slug for the same page would mean revoking "the" link
      // leaves another one working.
      expect(again.json().slug).toBe(share.slug);

      const list = await app.inject({
        method: "GET",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(list.json().filter((s: { articleId: string }) => s.articleId === articleId)).toHaveLength(1);
    });
  });

  describe("the public page", () => {
    let slug: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId },
      });
      slug = res.json().slug;
    });

    it("serves the owner's highlights with attribution, to a request carrying no credentials at all", async () => {
      const res = await app.inject({ method: "GET", url: `/api/public/shares/${slug}` });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.title).toBe("A Shared Essay");
      expect(body.highlightCount).toBe(2);
      expect(body.articles).toHaveLength(1);
      expect(body.articles[0].source).toEqual({
        title: "A Shared Essay",
        author: "A. Writer",
        siteName: "Example",
        url: "https://example.com/shared-essay",
      });
      expect(body.articles[0].highlights[0]).toEqual({
        text: "The first passage the owner chose to keep.",
        note: "Why this mattered to me.",
        color: "YELLOW",
      });
    });

    it("omits every private field, at every depth", async () => {
      const res = await app.inject({ method: "GET", url: `/api/public/shares/${slug}` });
      const keys = collectKeys(res.json());
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys, `public payload must not carry "${forbidden}"`).not.toContain(forbidden);
      }
    });

    it("leaks neither the account nor the article body nor anything else in the library", async () => {
      const res = await app.inject({ method: "GET", url: `/api/public/shares/${slug}` });
      const raw = res.body;

      expect(raw).not.toContain(OWNER_EMAIL);
      expect(raw).not.toContain("Share Owner");
      expect(raw).not.toContain(ownerId);
      // Excerpts, not the article: publishing the extracted body of a
      // copyrighted page is the thing this feature is explicitly not.
      expect(raw).not.toContain("PRIVATE-EXTRACTED-BODY");
      expect(raw).not.toContain("PRIVATE-PUBLISHER-EXCERPT");
      expect(raw).not.toContain("PRIVATE-COVER");
      expect(raw).not.toContain("private-tag");
      // Nothing about the rest of the library, including that it exists.
      expect(raw).not.toContain(PRIVATE_ARTICLE_TITLE);
      expect(raw).not.toContain("PRIVATE-OTHER-HIGHLIGHT");
    });

    it("answers an unknown slug exactly the way it answers a revoked one", async () => {
      const unknown = await app.inject({ method: "GET", url: "/api/public/shares/AAAAAAAAAAAAAAAAAAAAAA" });
      expect(unknown.statusCode).toBe(404);

      const revokedShape = { error: "not_found", message: "This link isn't available." };
      expect(unknown.json()).toEqual(revokedShape);
    });

    it("stops serving once the article is trashed", async () => {
      const trashArticle = await prisma.article.create({
        data: { userId: ownerId, title: "Soon To Be Trashed" },
      });
      const created = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId: trashArticle.id },
      });
      const trashSlug = created.json().slug;
      expect((await app.inject({ method: "GET", url: `/api/public/shares/${trashSlug}` })).statusCode).toBe(200);

      await prisma.article.update({ where: { id: trashArticle.id }, data: { deletedAt: new Date() } });
      expect((await app.inject({ method: "GET", url: `/api/public/shares/${trashSlug}` })).statusCode).toBe(404);
    });
  });

  describe("revocation", () => {
    it("kills the old URL for good, and re-sharing mints a different one", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { collectionId },
      });
      const { id, slug } = created.json();
      expect((await app.inject({ method: "GET", url: `/api/public/shares/${slug}` })).statusCode).toBe(200);

      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/shares/${id}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(revoked.statusCode).toBe(204);

      const afterRevoke = await app.inject({ method: "GET", url: `/api/public/shares/${slug}` });
      expect(afterRevoke.statusCode).toBe(404);
      expect(afterRevoke.json()).toEqual({ error: "not_found", message: "This link isn't available." });

      // Nothing is left holding the old slug -- the row is gone, not
      // flagged, so there is no state anyone could flip back.
      expect(await prisma.share.findUnique({ where: { slug } })).toBeNull();

      const reshared = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { collectionId },
      });
      expect(reshared.json().slug).not.toBe(slug);
      expect((await app.inject({ method: "GET", url: `/api/public/shares/${slug}` })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: "GET", url: `/api/public/shares/${reshared.json().slug}` })).statusCode,
      ).toBe(200);
    });

    it("won't let one account revoke another's share", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { articleId: otherArticleId },
      });
      const res = await app.inject({
        method: "DELETE",
        url: `/api/shares/${created.json().id}`,
        headers: { authorization: `Bearer ${strangerToken}` },
      });
      expect(res.statusCode).toBe(404);
      expect(await prisma.share.findUnique({ where: { id: created.json().id } })).not.toBeNull();
    });
  });

  describe("a shared collection", () => {
    it("publishes only articles that actually have highlights", async () => {
      const empty = await prisma.article.create({ data: { userId: ownerId, title: "NO-HIGHLIGHTS-HERE" } });
      await prisma.articleCollection.create({ data: { collectionId, articleId: empty.id } });

      const created = await app.inject({
        method: "POST",
        url: "/api/shares",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { collectionId },
      });
      const res = await app.inject({ method: "GET", url: `/api/public/shares/${created.json().slug}` });

      expect(res.json().title).toBe("Reading Notes");
      expect(res.body).not.toContain("NO-HIGHLIGHTS-HERE");
      expect(res.json().articles.map((a: { source: { title: string } }) => a.source.title)).toEqual([
        "A Shared Essay",
      ]);
    });
  });
});
