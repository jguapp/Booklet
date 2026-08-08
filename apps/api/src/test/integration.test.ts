import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MAX_RECALL_PROMPT_LENGTH } from "@booklet/shared";
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
      // No prompt asked for, no prompt stored -- the highlight keeps the
      // original show-then-grade review behavior (#157).
      expect(body.prompt).toBeNull();
      highlightId = body.id;
    });

    it("stores a recall prompt given at creation time, trimmed", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/highlights",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articleId,
          selectedText: "another passage",
          position: { type: "text", exact: "another passage", prefix: "", suffix: "", start: 10, end: 25 },
          color: "GREEN",
          prompt: "  What does this passage claim?  ",
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().prompt).toBe("What does this passage claim?");
    });

    // A whitespace-only prompt would read as "prompted" to every check in the
    // app while asking the reader nothing -- the review card would conceal
    // the answer behind a blank question.
    it("treats a whitespace-only prompt as no prompt at all", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/highlights",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articleId,
          selectedText: "a third passage",
          position: { type: "text", exact: "a third passage", prefix: "", suffix: "", start: 26, end: 41 },
          color: "BLUE",
          prompt: "   \n  ",
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().prompt).toBeNull();
    });

    it("rejects a prompt past the length cap", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/highlights",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articleId,
          selectedText: "a fourth passage",
          position: { type: "text", exact: "a fourth passage", prefix: "", suffix: "", start: 42, end: 58 },
          color: "PINK",
          prompt: "q".repeat(MAX_RECALL_PROMPT_LENGTH + 1),
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_prompt");
    });

    it("adds a prompt to an existing highlight, then clears it with null", async () => {
      const added = await app.inject({
        method: "PATCH",
        url: `/api/highlights/${highlightId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { prompt: "Why does this matter?" },
      });
      expect(added.statusCode).toBe(200);
      expect(added.json().prompt).toBe("Why does this matter?");

      // An unrelated PATCH must not disturb it -- prompt is only written when
      // the key is actually present in the body.
      const untouched = await app.inject({
        method: "PATCH",
        url: `/api/highlights/${highlightId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { color: "ORANGE" },
      });
      expect(untouched.json().prompt).toBe("Why does this matter?");

      const cleared = await app.inject({
        method: "PATCH",
        url: `/api/highlights/${highlightId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { prompt: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().prompt).toBeNull();
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

    /**
     * The migrated article used to arrive with canonicalUrl: null, because
     * the import route simply never set it. Duplicate detection matches on
     * `url OR canonicalUrl`, so re-saving the same article from a link
     * carrying a tracking parameter missed both arms and created a second
     * copy -- silently, permanently (nothing backfills the column), and
     * only for the articles a user cared enough about to have saved before
     * signing up.
     */
    it("derives canonicalUrl on import, so duplicate detection still works afterwards", async () => {
      const url = "https://example.com/vitest-canonical-import";
      await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [{ localId: "canon-1", url, title: "Migrated" }],
          highlights: [],
        },
      });

      const migrated = await prisma.article.findFirst({ where: { url } });
      expect(migrated?.canonicalUrl).toBeTruthy();

      // The same article, shared with a tracking parameter -- what a real
      // re-save looks like. Must be recognised as already saved.
      const again = await app.inject({
        method: "POST",
        url: "/api/articles",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { url: `${url}?utm_source=newsletter` },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe("already_saved");
    });

    /**
     * #171. The review schedule a user built up reading anonymously used to
     * be destroyed by the one action that promises to preserve their data.
     * surfaceCount and lastFeedback crossed the seam and the four SM-2
     * columns did not, so the library went on showing "Remembered, 4
     * reviews" while the scheduler believed the highlight had never been
     * seen -- and the next Daily Review served everything at once, weeks
     * after the signup that caused it.
     *
     * Asserts on the values rather than a 200, because a 200 is exactly
     * what the broken version returned.
     */
    it("carries a highlight's SM-2 schedule across the migration", async () => {
      const nextDueAt = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000);
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [{ localId: "sm2-1", url: "https://example.com/vitest-sm2", title: "SM2" }],
          highlights: [
            {
              localArticleId: "sm2-1",
              selectedText: "reviewed four times already",
              position: { type: "text", exact: "reviewed", prefix: "", suffix: "", start: 0, end: 8 },
              color: "YELLOW",
              surfaceCount: 4,
              lastFeedback: "REMEMBERED",
              easinessFactor: 2.6,
              intervalDays: 16,
              repetitions: 4,
              nextDueAt: nextDueAt.toISOString(),
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const article = await prisma.article.findFirst({
        where: { url: "https://example.com/vitest-sm2" },
        include: { highlights: true },
      });
      const h = article!.highlights[0]!;
      expect(h.easinessFactor).toBe(2.6);
      expect(h.intervalDays).toBe(16);
      expect(h.repetitions).toBe(4);
      expect(h.nextDueAt?.toISOString()).toBe(nextDueAt.toISOString());
      // The two that always survived, asserted alongside so the pair can't
      // drift apart again without a test noticing.
      expect(h.surfaceCount).toBe(4);
      expect(h.lastFeedback).toBe("REMEMBERED");
    });

    // An older client, or a highlight genuinely never reviewed, sends none
    // of this -- it has to import cleanly and land on the schema defaults.
    it("falls back to the schema defaults when SM-2 state is absent or out of range", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          articles: [{ localId: "sm2-2", url: "https://example.com/vitest-sm2-defaults", title: "SM2 defaults" }],
          highlights: [
            {
              localArticleId: "sm2-2",
              selectedText: "never reviewed",
              position: { type: "text", exact: "never", prefix: "", suffix: "", start: 0, end: 5 },
              color: "YELLOW",
            },
            {
              localArticleId: "sm2-2",
              selectedText: "nonsense schedule",
              position: { type: "text", exact: "nonsense", prefix: "", suffix: "", start: 6, end: 14 },
              color: "GREEN",
              // Below SM-2's 1.3 floor, negative, fractional, unparseable --
              // the import route must not be a way around the validation
              // PATCH /api/highlights/:id enforces on these same columns.
              easinessFactor: 0.1,
              intervalDays: -5,
              repetitions: 1.5,
              nextDueAt: "not a date",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const article = await prisma.article.findFirst({
        where: { url: "https://example.com/vitest-sm2-defaults" },
        include: { highlights: true },
      });
      expect(article?.highlights).toHaveLength(2);
      for (const h of article!.highlights) {
        expect(h.easinessFactor).toBe(2.5);
        expect(h.intervalDays).toBe(0);
        expect(h.repetitions).toBe(0);
        expect(h.nextDueAt).toBeNull();
      }
    });

    /** Hand-rolled because there is no form-data dependency here and the
     * body is one small field -- @fastify/multipart parses whatever arrives
     * on the wire, which is what inject() delivers. */
    function multipart(filename: string, contentType: string, content: Buffer) {
      const boundary = `----vitest${Math.random().toString(16).slice(2)}`;
      return {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
              `Content-Type: ${contentType}\r\n\r\n`,
          ),
          content,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      };
    }

    async function importOne(localId: string, article: Record<string, unknown>): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { articles: [{ localId, ...article }], highlights: [] },
      });
      expect(res.statusCode).toBe(200);
      return res.json().localIdToServerId[localId];
    }

    /**
     * #172. The server mints a fresh id for every imported article, while
     * the browser keys an uploaded PDF's bytes in IndexedDB by the *local*
     * id. The route has always built this map to attach highlights and
     * simply never sent it, so nothing on the client could say which server
     * article a local file belonged to -- and the file was therefore never
     * migrated at all.
     */
    it("returns the localId -> server id map, including for skipped duplicates", async () => {
      const url = "https://example.com/vitest-idmap";
      const first = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { articles: [{ localId: "map-1", url, title: "Mapped" }], highlights: [] },
      });
      const serverId = first.json().localIdToServerId["map-1"];
      expect(serverId).toBeTypeOf("string");

      const fetched = await app.inject({
        method: "GET",
        url: `/api/articles/${serverId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json().title).toBe("Mapped");

      // A re-sent batch (the response to the first one was lost) has to map
      // to the row that already exists, or the retry has no id to attach the
      // file to and the book stays empty for good.
      const replay = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { articles: [{ localId: "map-1", url, title: "Mapped" }], highlights: [] },
      });
      expect(replay.json()).toMatchObject({ skippedArticles: 1 });
      expect(replay.json().localIdToServerId["map-1"]).toBe(serverId);
    });

    /**
     * The acceptance criterion of #172: a PDF uploaded anonymously opens
     * normally after signing up. Before this, the migrated row arrived with
     * fileStorageKey: null and GET /file answered 404 forever, while the
     * bytes sat unreachable in the browser -- and an upload is one of the
     * few things a user cannot re-acquire by re-saving a URL.
     */
    it("attaches an uploaded PDF's bytes to the article the migration created", async () => {
      const pdf = Buffer.from("%PDF-1.4\nvitest migrated bytes\n%%EOF");
      const articleId = await importOne("pdf-1", { title: "My uploaded book", sourceType: "PDF", url: null });

      // The gap the reader falls back to IndexedDB across -- the row is
      // there, the file is not yet.
      const beforeUpload = await app.inject({
        method: "GET",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(beforeUpload.statusCode).toBe(404);

      const form = multipart("book.pdf", "application/pdf", pdf);
      const upload = await app.inject({
        method: "POST",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}`, ...form.headers },
        payload: form.payload,
      });
      expect(upload.statusCode).toBe(200);
      expect(upload.json().fileStorageKey).toBeTruthy();
      // Nothing else on the row is touched: the title came from the client's
      // own extraction and must not be re-derived from the file.
      expect(upload.json().title).toBe("My uploaded book");

      const served = await app.inject({
        method: "GET",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("application/pdf");
      expect(served.rawPayload.equals(pdf)).toBe(true);

      // Also removes the file this test wrote to disk.
      await app.inject({
        method: "DELETE",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    it("does the same for an EPUB, and serves it back with the EPUB content type", async () => {
      const epub = Buffer.from("PKvitest-epub");
      const articleId = await importOne("epub-1", { title: "Migrated EPUB", sourceType: "EPUB", url: null });

      const form = multipart("book.epub", "application/epub+zip", epub);
      const upload = await app.inject({
        method: "POST",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}`, ...form.headers },
        payload: form.payload,
      });
      expect(upload.statusCode).toBe(200);

      const served = await app.inject({
        method: "GET",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("application/epub+zip");
      expect(served.rawPayload.equals(epub)).toBe(true);

      await app.inject({
        method: "DELETE",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    /**
     * The client deletes a file from IndexedDB only once this route has
     * accepted it, so an accepted upload whose response was lost is sent
     * again -- the batch-then-clear rule #164 established, applied to files.
     * Writing a second copy would leave the first orphaned on disk with
     * nothing pointing at it.
     */
    it("treats a replayed file upload as a no-op instead of storing a second copy", async () => {
      const pdf = Buffer.from("%PDF-1.4\nreplayed\n%%EOF");
      const articleId = await importOne("pdf-replay", { title: "Replayed book", sourceType: "PDF", url: null });

      const send = () => {
        const form = multipart("book.pdf", "application/pdf", pdf);
        return app.inject({
          method: "POST",
          url: `/api/articles/${articleId}/file`,
          headers: { authorization: `Bearer ${accessToken}`, ...form.headers },
          payload: form.payload,
        });
      };

      const first = await send();
      const replay = await send();
      expect(replay.statusCode).toBe(200);
      expect(replay.json().fileStorageKey).toBe(first.json().fileStorageKey);

      await app.inject({
        method: "DELETE",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    // GET /file picks its Content-Type from sourceType alone, so EPUB bytes
    // on a row that says PDF would be served as application/pdf and fail to
    // open in a reader that trusts the header.
    it("refuses file bytes that don't match the article's declared type, and an unknown article", async () => {
      const articleId = await importOne("pdf-mismatch", { title: "Mismatch", sourceType: "PDF", url: null });

      const form = multipart("book.epub", "application/epub+zip", Buffer.from("PK"));
      const mismatch = await app.inject({
        method: "POST",
        url: `/api/articles/${articleId}/file`,
        headers: { authorization: `Bearer ${accessToken}`, ...form.headers },
        payload: form.payload,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().error).toBe("type_mismatch");

      const stray = multipart("book.pdf", "application/pdf", Buffer.from("%PDF-1.4"));
      const unknown = await app.inject({
        method: "POST",
        url: "/api/articles/00000000-0000-0000-0000-000000000000/file",
        headers: { authorization: `Bearer ${accessToken}`, ...stray.headers },
        payload: stray.payload,
      });
      expect(unknown.statusCode).toBe(404);
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
