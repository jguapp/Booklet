import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PODCAST_FEED_SCOPE } from "@booklet/shared";

/**
 * End-to-end coverage of the podcast feed (#154) with the TTS pool replaced
 * by a generator of synthetic PCM.
 *
 * The substitution is what makes this test possible at all -- real generation
 * means loading a ~90 MB Kokoro model per worker -- but it costs less than it
 * looks like: everything between "text" and "an episode a client can
 * download" is exercised for real. Chunking, the low-priority enqueue, the
 * WAV concatenation, the ArticleAudio row, the storage write and the byte
 * stream back out are all the production code paths. Only the samples are
 * synthetic, and the samples are the one part nothing here asserts on.
 */

const SAMPLE_RATE = 24000;

/** Same shape wav-pcm16.ts emits: flat 44-byte header, mono 16-bit PCM. */
function pcm16Wav(sampleCount: number): Buffer {
  const dataBytes = sampleCount * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write("RIFF", 0, "ascii");
  view.setUint32(4, 36 + dataBytes, true);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  buf.write("data", 36, "ascii");
  view.setUint32(40, dataBytes, true);
  return buf;
}

/** One tenth of a second per chunk -- enough to make the concatenated
 * duration a number worth asserting on, small enough that a whole article is
 * kilobytes. */
const CHUNK_SAMPLES = SAMPLE_RATE / 10;

type PooledArgs = [text: string, voice: string, speed: number, options?: { speculative?: boolean }];

const generateSpeechPooled = vi.fn(async (..._args: PooledArgs) => pcm16Wav(CHUNK_SAMPLES));
vi.mock("../services/tts-pool.js", () => ({
  generateSpeechPooled: (...args: PooledArgs) => generateSpeechPooled(...args),
  generateSpeechWithTimings: vi.fn(),
  ttsPoolStatus: () => ({ started: false, workers: 0, loaded: 0 }),
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { deleteStoredFile } = await import("../services/storage-service.js");

const TEST_EMAIL = `vitest-podcast-${Date.now()}@test.local`;
const OTHER_EMAIL = `vitest-podcast-other-${Date.now()}@test.local`;
const TEST_PASSWORD = "hunter22222";

/** Long enough to become several chunks (tts-chunking caps at 140 chars, and
 * the first at 80), so concatenation is actually exercised. */
const ARTICLE_TEXT = Array.from(
  { length: 8 },
  (_, i) => `This is sentence number ${i} of a test article, written to be read aloud by a synthetic voice.`,
).join(" ");

async function waitForAudio(articleId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.articleAudio.findUnique({ where: { articleId } });
    if (row) return row;
    if (Date.now() > deadline) throw new Error(`No ArticleAudio for ${articleId} within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split("/")[2];
}

describe("podcast feed", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  let otherUserId: string;
  let queuedArticleId: string;
  let archivedArticleId: string;
  let feedUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD, name: "Vitest Listener" },
    });
    accessToken = signup.json().accessToken;
    userId = signup.json().user.id;

    const other = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: OTHER_EMAIL, password: TEST_PASSWORD },
    });
    otherUserId = other.json().user.id;

    // Created through Prisma rather than POST /api/articles: that route runs
    // real extraction against a live URL, which this suite has no business
    // doing.
    const queued = await prisma.article.create({
      data: {
        userId,
        url: "https://example.com/type-history",
        title: "Barnes & Noble: a history of <type>",
        author: "Jane Roe",
        siteName: "Example Review",
        excerpt: "A short excerpt.",
        extractionStatus: "SUCCESS",
        extractedText: ARTICLE_TEXT,
        readingTimeEstimate: 4,
        status: "UNREAD",
      },
    });
    queuedArticleId = queued.id;

    const archived = await prisma.article.create({
      data: {
        userId,
        url: "https://example.com/archived",
        title: "Already read",
        extractionStatus: "SUCCESS",
        extractedText: ARTICLE_TEXT,
        status: "ARCHIVED",
      },
    });
    archivedArticleId = archived.id;

    // No extracted text -- a failed extraction or a scanned PDF. Must never
    // reach the feed, and must never be handed to the TTS pool.
    await prisma.article.create({
      data: { userId, url: "https://example.com/no-text", title: "Nothing to read", extractionStatus: "FAILED" },
    });
  });

  afterAll(async () => {
    const audio = await prisma.articleAudio.findMany({ where: { article: { userId } } });
    await Promise.all(audio.map((row) => deleteStoredFile(row.storageKey).catch(() => undefined)));
    await prisma.user.deleteMany({ where: { email: { in: [TEST_EMAIL, OTHER_EMAIL] } } });
    await app.close();
  });

  describe("minting the URL", () => {
    it("requires a signed-in session", async () => {
      expect((await app.inject({ method: "POST", url: "/api/podcast/feed" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/podcast/feed" })).statusCode).toBe(401);
    });

    it("reports no feed before one is created", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.json()).toMatchObject({ enabled: false, createdAt: null, lastFetchedAt: null });
    });

    it("returns an absolute, prefixed feed URL exactly once", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(201);
      feedUrl = res.json().url;

      expect(feedUrl).toMatch(/^https?:\/\/[^/]+\/podcast\/bkpod_[0-9a-f]{64}\/feed\.xml$/);
      expect(res.json().enabled).toBe(true);

      // The raw token is never stored, so nothing can show it again.
      const status = await app.inject({
        method: "GET",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(status.json()).toMatchObject({ enabled: true });
      expect(status.json()).not.toHaveProperty("url");
      const stored = await prisma.apiToken.findFirst({ where: { userId, scopes: { has: PODCAST_FEED_SCOPE } } });
      expect(stored!.tokenHash).not.toContain(tokenFromUrl(feedUrl));
    });
  });

  /**
   * The issue's "feed token ... unusable against other API routes" criterion.
   * These are the tests that hold that boundary in place, so they assert the
   * mechanism (the token never becomes a session) rather than a status code
   * on one route that happens to check a scope.
   */
  describe("token isolation", () => {
    it("cannot authenticate against /api/v1", async () => {
      const token = tokenFromUrl(feedUrl);
      for (const url of ["/api/v1/articles", "/api/v1/highlights", "/api/v1/collections"]) {
        const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode, url).toBe(401);
      }
    });

    it("cannot authenticate against the internal API or create anything", async () => {
      const token = tokenFromUrl(feedUrl);
      const read = await app.inject({
        method: "GET",
        url: "/api/articles",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(read.statusCode).toBe(401);

      const write = await app.inject({
        method: "POST",
        url: "/api/v1/articles",
        headers: { authorization: `Bearer ${token}` },
        payload: { url: "https://example.com/should-not-happen" },
      });
      expect(write.statusCode).toBe(401);
    });

    it("cannot be minted through the personal-access-token form", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/tokens",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: "sneaky", scopes: [PODCAST_FEED_SCOPE] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_scopes");
    });

    it("is separately revocable -- invisible to, and untouchable by, the token list", async () => {
      const list = await app.inject({
        method: "GET",
        url: "/api/tokens",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(list.json().some((t: { scopes: string[] }) => t.scopes.includes(PODCAST_FEED_SCOPE))).toBe(false);

      const row = await prisma.apiToken.findFirst({
        where: { userId, revokedAt: null, scopes: { has: PODCAST_FEED_SCOPE } },
      });
      const revoke = await app.inject({
        method: "DELETE",
        url: `/api/tokens/${row!.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(revoke.statusCode).toBe(404);
      expect((await prisma.apiToken.findUnique({ where: { id: row!.id } }))!.revokedAt).toBeNull();
    });

    it("does not let an ordinary personal access token reach the feed", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/tokens",
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: "a script", scopes: ["read"] },
      });
      const pat = created.json().token;
      // Same route shape, a valid non-revoked ApiToken row for the same user,
      // rejected purely because it lacks the feed scope.
      const res = await app.inject({ method: "GET", url: `/podcast/${pat}/feed.xml` });
      expect(res.statusCode).toBe(404);
    });

    it("404s an unknown or malformed token rather than inviting a retry", async () => {
      expect((await app.inject({ method: "GET", url: "/podcast/bkpod_deadbeef/feed.xml" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/podcast/not-a-token/feed.xml" })).statusCode).toBe(404);
    });
  });

  describe("serving the feed", () => {
    it("serves RSS, records the fetch, and starts generating what is missing", async () => {
      const res = await app.inject({ method: "GET", url: feedUrl });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/rss+xml");
      // The document embeds the secret URL, so it must not land in a shared cache.
      expect(res.headers["cache-control"]).toContain("private");
      expect(res.body).toContain("<rss");
      // Nothing has audio yet, so there is nothing to list.
      expect(res.body).not.toContain("<item>");

      const status = await app.inject({
        method: "GET",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(status.json().lastFetchedAt).not.toBeNull();
    });

    it("enqueues every chunk as speculative work, so live playback is never behind it", async () => {
      await waitForAudio(queuedArticleId);

      expect(generateSpeechPooled).toHaveBeenCalled();
      for (const call of generateSpeechPooled.mock.calls) {
        // The fourth argument is what puts the chunk on tts-pool.ts's
        // lowPriorityQueue instead of the queue a listener is waiting on.
        expect(call[3]).toEqual({ speculative: true });
      }
    });

    it("concatenates the chunks into one file and records its real size", async () => {
      const audio = await waitForAudio(queuedArticleId);

      expect(audio.voice).toBe("af_heart");
      expect(audio.speed).toBe(1);
      // Every chunk contributed CHUNK_SAMPLES, spliced behind a single header.
      const chunkCount = (audio.bytes - 44) / (CHUNK_SAMPLES * 2);
      expect(Number.isInteger(chunkCount)).toBe(true);
      expect(chunkCount).toBeGreaterThan(1);
      expect(audio.durationSeconds).toBe(Math.round(chunkCount / 10));
    });

    it("lists a ready episode with a complete enclosure", async () => {
      const audio = await waitForAudio(queuedArticleId);
      const res = await app.inject({ method: "GET", url: feedUrl });

      expect(res.body).toContain("<item>");
      expect(res.body).toContain(`booklet-article-${queuedArticleId}`);
      expect(res.body).toContain(`length="${audio.bytes}"`);
      expect(res.body).toContain('type="audio/wav"');
      // A title with an ampersand and angle brackets, escaped rather than
      // breaking the document.
      expect(res.body).toContain("Barnes &amp; Noble: a history of &lt;type&gt;");
      expect(res.body).not.toContain("Barnes & Noble");
    });

    it("never offers an article with no extracted text to the TTS pool", async () => {
      const texts = generateSpeechPooled.mock.calls.map((call) => call[0]);
      expect(texts.every((text) => text.trim().length > 0)).toBe(true);
      expect(await prisma.articleAudio.findMany({ where: { article: { title: "Nothing to read" } } })).toHaveLength(0);
    });

    it("defaults to the queue and only includes archived articles on request", async () => {
      const queueOnly = await app.inject({ method: "GET", url: feedUrl });
      expect(queueOnly.body).not.toContain(`booklet-article-${archivedArticleId}`);

      // filter=all changes which articles are candidates; the archived one
      // still needs its audio generated before it can appear as an item.
      await app.inject({ method: "GET", url: `${feedUrl}?filter=all` });
      await waitForAudio(archivedArticleId);
      const all = await app.inject({ method: "GET", url: `${feedUrl}?filter=all` });
      expect(all.body).toContain(`booklet-article-${archivedArticleId}`);
    });
  });

  describe("serving an enclosure", () => {
    it("streams the concatenated WAV with the length the feed advertised", async () => {
      const audio = await waitForAudio(queuedArticleId);
      const res = await app.inject({
        method: "GET",
        url: `/podcast/${tokenFromUrl(feedUrl)}/episodes/${queuedArticleId}/audio.wav`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/wav");
      expect(res.headers["content-length"]).toBe(String(audio.bytes));
      expect(res.rawPayload.length).toBe(audio.bytes);
      expect(res.rawPayload.toString("ascii", 0, 4)).toBe("RIFF");
      expect(res.rawPayload.toString("ascii", 8, 12)).toBe("WAVE");
      expect(res.rawPayload.readUInt32LE(40)).toBe(audio.bytes - 44);
    });

    it("does not serve another account's article", async () => {
      const theirs = await prisma.article.create({
        data: { userId: otherUserId, url: "https://example.com/private", extractedText: "Private." },
      });
      const res = await app.inject({
        method: "GET",
        url: `/podcast/${tokenFromUrl(feedUrl)}/episodes/${theirs.id}/audio.wav`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("says come back later, not gone, for an episode that has no audio yet", async () => {
      const pending = await prisma.article.create({
        data: { userId, url: "https://example.com/pending", extractedText: "Pending." },
      });
      const res = await app.inject({
        method: "GET",
        url: `/podcast/${tokenFromUrl(feedUrl)}/episodes/${pending.id}/audio.wav`,
      });
      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBeDefined();
    });
  });

  describe("revocation", () => {
    it("regenerating invalidates the previous URL immediately", async () => {
      const previous = feedUrl;
      const res = await app.inject({
        method: "POST",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      feedUrl = res.json().url;

      expect(feedUrl).not.toBe(previous);
      expect((await app.inject({ method: "GET", url: previous })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: feedUrl })).statusCode).toBe(200);
    });

    it("turning the feed off kills the enclosures with it", async () => {
      const token = tokenFromUrl(feedUrl);
      const off = await app.inject({
        method: "DELETE",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(off.statusCode).toBe(204);

      expect((await app.inject({ method: "GET", url: feedUrl })).statusCode).toBe(404);
      const enclosure = await app.inject({
        method: "GET",
        url: `/podcast/${token}/episodes/${queuedArticleId}/audio.wav`,
      });
      expect(enclosure.statusCode).toBe(404);

      const status = await app.inject({
        method: "GET",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(status.json().enabled).toBe(false);
    });

    it("404s a second turn-off, since there is nothing left to revoke", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
