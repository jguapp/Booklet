import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const TEST_EMAIL = `vitest-${Date.now()}@test.local`;
const TEST_PASSWORD = "hunter22222";

describe("API integration", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let refreshCookie: string;
  let articleId: string;
  let highlightId: string;
  let collectionId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
  });

  describe("cors", () => {
    it("allows chrome-extension:// and moz-extension:// origins, but not an arbitrary one", async () => {
      const chromeRes = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
      });
      expect(chromeRes.headers["access-control-allow-origin"]).toBe(
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      );

      const firefoxRes = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "moz-extension://12345678-1234-1234-1234-123456789012" },
      });
      expect(firefoxRes.headers["access-control-allow-origin"]).toBe(
        "moz-extension://12345678-1234-1234-1234-123456789012",
      );

      const untrustedRes = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "https://evil.example.com" },
      });
      expect(untrustedRes.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("auth", () => {
    it("rejects signup with a too-short password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: TEST_EMAIL, password: "short" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("signs up, returning an access token and an unverified user", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: TEST_EMAIL, password: TEST_PASSWORD, name: "Vitest" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.email).toBe(TEST_EMAIL);
      expect(body.user.emailVerified).toBe(false);
      expect(body.accessToken).toBeTypeOf("string");

      accessToken = body.accessToken;
      const setCookie = res.cookies.find((c) => c.name === "booklet_refresh");
      expect(setCookie).toBeDefined();
      refreshCookie = `${setCookie!.name}=${setCookie!.value}`;
    });

    it("rejects a duplicate signup", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects login with the wrong password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: TEST_EMAIL, password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/auth/me requires a valid access token", async () => {
      const unauthed = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(unauthed.statusCode).toBe(401);

      const authed = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(authed.statusCode).toBe(200);
      expect(authed.json().email).toBe(TEST_EMAIL);
    });

    it("rotates the refresh token and rejects reuse of the old one", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: refreshCookie },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().accessToken).toBeTypeOf("string");

      const reused = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: refreshCookie },
      });
      expect(reused.statusCode).toBe(401);

      const newCookie = first.cookies.find((c) => c.name === "booklet_refresh");
      refreshCookie = `${newCookie!.name}=${newCookie!.value}`;
      accessToken = first.json().accessToken;
    });

    // This process never sets GOOGLE_CLIENT_ID/GITHUB_CLIENT_ID (see
    // oauth.test.ts for the configured-provider behavior, which needs those
    // set before oauth.ts is first imported) -- so this is also exactly
    // what a real deployment with no OAuth apps registered actually does.
    it("reports both OAuth providers as unconfigured by default", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/oauth/providers" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ google: false, github: false });
    });

    it("404s starting an OAuth flow for an unconfigured provider", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/oauth/google" });
      expect(res.statusCode).toBe(404);
    });

    it("404s starting an OAuth flow for an unknown provider", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/oauth/facebook" });
      expect(res.statusCode).toBe(404);
    });

    it("sends an unconfigured provider's callback back to login with an error", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/oauth/google/callback?code=x&state=y" });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("/login?error=oauth_failed");
    });
  });

  describe("articles", () => {
    it("rejects article creation without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/articles",
        payload: { url: "https://example.com/a" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("creates an article, recording a failed extraction gracefully for an unreachable URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/articles",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { url: "http://127.0.0.1:1/definitely-unreachable" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.extractionStatus).toBe("FAILED");
      articleId = body.id;
    });

    it("finds an already-saved article by URL, matching the canonical form too", async () => {
      const exact = await app.inject({
        method: "GET",
        url: `/api/articles?url=${encodeURIComponent("http://127.0.0.1:1/definitely-unreachable")}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(exact.json().articles).toHaveLength(1);
      expect(exact.json().articles[0].id).toBe(articleId);

      // The extension looks a page up by whatever URL the tab happens to
      // have, which routinely carries tracking params the saved row doesn't.
      // This has to match the same way the duplicate check does, or the
      // "already saved" path would fail to find a row that a re-save would
      // still reject as a 409.
      const decorated = await app.inject({
        method: "GET",
        url: `/api/articles?url=${encodeURIComponent("http://127.0.0.1:1/definitely-unreachable?utm_source=twitter")}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(decorated.json().articles).toHaveLength(1);
      expect(decorated.json().articles[0].id).toBe(articleId);

      const missing = await app.inject({
        method: "GET",
        url: `/api/articles?url=${encodeURIComponent("http://127.0.0.1:1/never-saved")}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(missing.json().articles).toHaveLength(0);
    });

    it("rejects saving the same URL twice", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/articles",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { url: "http://127.0.0.1:1/definitely-unreachable" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("lists articles for the authenticated user", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/articles",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.articles.some((a: { id: string }) => a.id === articleId)).toBe(true);
    });

    it("updates article status, setting readAt on transition to READING", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { status: "READING" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("READING");
      expect(body.readAt).not.toBeNull();
    });

    it("404s for another user's (or nonexistent) article id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/articles/not-a-real-id",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("sets, dedupes, and trims tags via PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { tags: ["Reading ", "reading", "later"] },
      });
      expect(res.statusCode).toBe(200);
      // "Reading " and "reading" are distinct after trim-only (no case-folding) --
      // dedup is exact-string, so both survive; this asserts trim happened and
      // the array shape round-trips, not that near-duplicates are merged.
      expect(res.json().tags.sort()).toEqual(["Reading", "later", "reading"].sort());
    });

    it("rejects non-string or oversized tags", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { tags: ["ok", "x".repeat(41)] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("filters the article list by tag", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/articles?tag=later",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.articles.some((a: { id: string }) => a.id === articleId)).toBe(true);

      const missTag = await app.inject({
        method: "GET",
        url: "/api/articles?tag=nonexistent-tag",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(missTag.json().articles.some((a: { id: string }) => a.id === articleId)).toBe(false);
    });

    it("persists reading progress via PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { progressFraction: 0.42 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().progressFraction).toBeCloseTo(0.42);

      const reread = await app.inject({
        method: "GET",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(reread.json().progressFraction).toBeCloseTo(0.42);
    });

    it("rejects an out-of-range progressFraction", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { progressFraction: 1.5 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("search", () => {
    it("requires auth", async () => {
      const res = await app.inject({ method: "GET", url: "/api/search?q=reading" });
      expect(res.statusCode).toBe(401);
    });

    it("returns an empty result for a blank query rather than the whole library", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/search?q=",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ articles: [], highlights: [] });
    });

    it("finds the tagged article by its tag", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/search?q=later",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.articles.some((a: { id: string }) => a.id === articleId)).toBe(true);
    });
  });

  describe("highlights + annotations", () => {
    it("creates a highlight with a note in one request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/highlights",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articleId,
          selectedText: "a passage",
          position: { type: "text", exact: "a passage", prefix: "", suffix: "", start: 0, end: 9 },
          color: "YELLOW",
          noteText: "a thought",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.annotation?.noteText).toBe("a thought");
      expect(body.easinessFactor).toBe(2.5);
      expect(body.nextDueAt).toBeNull();
      highlightId = body.id;
    });

    it("updates SM-2 fields via PATCH", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/highlights/${highlightId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { easinessFactor: 2.6, intervalDays: 6, repetitions: 2, nextDueAt: "2099-01-01T00:00:00.000Z" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.intervalDays).toBe(6);
      expect(body.nextDueAt).toBe("2099-01-01T00:00:00.000Z");
    });

    it("updates the note via the annotation endpoint", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/highlights/${highlightId}/annotation`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { noteText: "an updated thought" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().annotation.noteText).toBe("an updated thought");
    });

    it("shows up in search by its selected text and by its note", async () => {
      const byText = await app.inject({
        method: "GET",
        url: "/api/search?q=passage",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(byText.json().highlights.some((h: { id: string }) => h.id === highlightId)).toBe(true);

      const byNote = await app.inject({
        method: "GET",
        url: "/api/search?q=updated%20thought",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(byNote.json().highlights.some((h: { id: string }) => h.id === highlightId)).toBe(true);
    });

    it("excludes a not-yet-due highlight from the resurfacing digest", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/digests/current",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // nextDueAt is 2099 (set above) -- shouldn't be selected.
      expect(body.highlights.some((h: { id: string }) => h.id === highlightId)).toBe(false);
    });
  });

  describe("collections", () => {
    it("creates a collection and rejects a duplicate name", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/collections",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: "Vitest Collection" },
      });
      expect(created.statusCode).toBe(201);
      collectionId = created.json().id;

      const dup = await app.inject({
        method: "POST",
        url: "/api/collections",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: "Vitest Collection" },
      });
      expect(dup.statusCode).toBe(409);
    });

    it("adds and lists an article in a collection", async () => {
      const add = await app.inject({
        method: "PUT",
        url: `/api/collections/${collectionId}/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(add.statusCode).toBe(204);

      const list = await app.inject({
        method: "GET",
        url: `/api/collections/${collectionId}/articles`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().some((a: { id: string }) => a.id === articleId)).toBe(true);
    });
  });

  describe("sync/import", () => {
    it("imports a local article, skips it on a repeat import (same URL), and attaches highlights", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [
            {
              localId: "local-1",
              url: "https://example.com/vitest-import",
              title: "Imported",
              author: null,
              siteName: null,
              excerpt: null,
              sourceType: "HTML",
              extractionStatus: "SUCCESS",
              extractionError: null,
              extractedHtml: "<p>hi</p>",
              extractedText: "hi",
              readingTimeEstimate: 1,
              progressFraction: 0,
              tags: ["imported-tag"],
              status: "UNREAD",
              savedAt: new Date().toISOString(),
              readAt: null,
              archivedAt: null,
            },
          ],
          highlights: [
            {
              localArticleId: "local-1",
              selectedText: "hi",
              position: { type: "text", exact: "hi", prefix: "", suffix: "", start: 0, end: 2 },
              color: "BLUE",
              lastSurfacedAt: null,
              surfaceCount: 0,
              lastFeedback: null,
              lastFeedbackAt: null,
              resurfaceArchivedAt: null,
              createdAt: new Date().toISOString(),
              noteText: null,
            },
          ],
          collections: [],
          articleCollections: [],
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ importedArticles: 1, importedHighlights: 1 });

      const imported = await app.inject({
        method: "GET",
        url: "/api/articles?tag=imported-tag",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(imported.json().articles).toHaveLength(1);

      const second = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [
            {
              localId: "local-1",
              url: "https://example.com/vitest-import",
              title: "Imported",
              author: null,
              siteName: null,
              excerpt: null,
              sourceType: "HTML",
              extractionStatus: "SUCCESS",
              extractionError: null,
              extractedHtml: "<p>hi</p>",
              extractedText: "hi",
              readingTimeEstimate: 1,
              progressFraction: 0,
              status: "UNREAD",
              savedAt: new Date().toISOString(),
              readAt: null,
              archivedAt: null,
            },
          ],
          highlights: [],
          collections: [],
          articleCollections: [],
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ importedArticles: 0, skippedArticles: 1 });
    });

    // #164: the migration used to go up as one JSON body, so Fastify's 1MB
    // default rejected it with 413 before the route was even reached -- and
    // the client swallowed that, leaving a brand-new account staring at an
    // empty library. Extraction inlines images as base64 up to 15MB an
    // article, so one ordinary image-heavy save is enough to trigger it.
    it("accepts an article far larger than Fastify's default 1MB body limit", async () => {
      const bigHtml = `<p>${"x".repeat(1_500_000)}</p>`;
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [
            {
              localId: "local-big",
              url: "https://example.com/vitest-import-big",
              title: "Big",
              extractedHtml: bigHtml,
              extractedText: "big",
            },
          ],
          highlights: [],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ importedArticles: 1 });
    });

    // Two local articles can share a URL (saved twice before dedupe existed).
    // Batched createMany would trip @@unique([userId, url]) and take the whole
    // import down, so the duplicate has to be folded into the first one.
    it("folds a URL duplicated within one payload instead of failing the batch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [
            { localId: "dup-a", url: "https://example.com/vitest-dupe", title: "A", extractedText: "a" },
            { localId: "dup-b", url: "https://example.com/vitest-dupe", title: "B", extractedText: "b" },
          ],
          highlights: [
            {
              localArticleId: "dup-b",
              selectedText: "from the duplicate",
              position: { type: "text", exact: "from the duplicate", prefix: "", suffix: "", start: 0, end: 18 },
              color: "BLUE",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      // One created, one folded -- and the folded one's highlight still lands,
      // attached to the article that was actually created.
      expect(res.json()).toMatchObject({ importedArticles: 1, skippedArticles: 1, importedHighlights: 1 });
    });

    // The client clears a batch from IndexedDB only once the server has
    // accepted it, so a batch the server committed but whose response was
    // lost gets re-sent. Articles dedupe by URL; highlights have no unique
    // constraint, so without an explicit guard a dropped response silently
    // doubles someone's notebook.
    it("does not duplicate highlights when a batch is replayed", async () => {
      const payload = {
        articles: [
          { localId: "replay-1", url: "https://example.com/vitest-replay", title: "Replay", extractedText: "body" },
        ],
        highlights: [
          {
            localArticleId: "replay-1",
            selectedText: "body",
            position: { type: "text", exact: "body", prefix: "", suffix: "", start: 0, end: 4 },
            color: "YELLOW",
          },
        ],
      };
      const send = () =>
        app.inject({
          method: "POST",
          url: "/api/sync/import",
          headers: { authorization: `Bearer ${accessToken}` },
          payload,
        });

      const first = await send();
      expect(first.json()).toMatchObject({ importedArticles: 1, importedHighlights: 1 });

      const replay = await send();
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ importedArticles: 0, skippedArticles: 1, importedHighlights: 0 });

      const article = await prisma.article.findFirst({
        where: { url: "https://example.com/vitest-replay" },
        include: { highlights: true },
      });
      expect(article?.highlights).toHaveLength(1);
    });
  });

  describe("logout", () => {
    it("revokes the session so a subsequent refresh fails", async () => {
      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: refreshCookie },
      });
      expect(logout.statusCode).toBe(204);

      const refresh = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: refreshCookie },
      });
      expect(refresh.statusCode).toBe(401);
    });
  });
});
