import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Audit finding S5: podcast audio grew forever.
 *
 * Every other bound on this feature is per-episode or per-poll --
 * MAX_EPISODE_CHUNKS caps one file, MAX_GENERATIONS_PER_FETCH caps one fetch
 * -- and none of them bound the total, because nothing ever deleted an
 * ArticleAudio file once its article stopped being advertised. A subscriber
 * with an ordinary reading queue converged on fifty stored WAVs, on the same
 * mounted disk as every user's uploaded PDFs, and the thing that broke when
 * it filled was uploads.
 *
 * So the assertions here are deliberately about the disk, not the database:
 * a row deleted while its bytes stay behind is the exact bug this is meant to
 * close, and only existsSync can tell the two apart. FILE_STORAGE_PATH points
 * at a temp directory for the same reason storage-persistence.test.ts does it
 * -- writes have to land somewhere this test can look at directly.
 *
 * Only tts-pool is mocked, matching podcast-routes.test.ts: the feed query,
 * the eviction pass, the quota aggregate, the storage writes and the unlinks
 * are all real code.
 */

// Both before app.js is imported: storage-service resolves its root once at
// module load, and podcast-storage.ts reads its quota once for the same
// reason (a limit that changes under a running server would refuse some
// requests and not others with no way to tell why).
const STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "booklet-podcast-storage-"));
process.env.FILE_STORAGE_PATH = STORAGE_DIR;

/** The override a deployment on a small disk would set. Four megabytes is far
 * above anything this file generates (a synthetic episode is tens of KB) and
 * far below the 2 GiB default, so the quota fires exactly when the test says
 * to and never by accident. */
const QUOTA_BYTES = 4_000_000;
process.env.PODCAST_AUDIO_QUOTA_BYTES = String(QUOTA_BYTES);

const SAMPLE_RATE = 24000;

/** Same shape wav-pcm16.ts emits: flat 44-byte header, mono 16-bit PCM.
 * Duplicated from podcast-routes.test.ts rather than shared -- a fixture
 * imported by two suites is a thing to keep in sync, and this is nine lines
 * of format that has not changed since it was written. */
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

type PooledArgs = [text: string, voice: string, speed: number, options?: { speculative?: boolean }];

const generateSpeechPooled = vi.fn(async (..._args: PooledArgs) => pcm16Wav(SAMPLE_RATE / 10));
vi.mock("../services/tts-pool.js", () => ({
  generateSpeechPooled: (...args: PooledArgs) => generateSpeechPooled(...args),
  generateSpeechWithTimings: vi.fn(),
  ttsPoolStatus: () => ({ started: false, workers: 0, loaded: 0 }),
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { saveFile } = await import("../services/storage-service.js");

const TEST_EMAIL = `vitest-podcast-storage-${Date.now()}@test.local`;
const TEST_PASSWORD = "hunter22222";

/** Several chunks long, so an episode is a concatenation rather than one
 * buffer passed through. */
const ARTICLE_TEXT = Array.from(
  { length: 8 },
  (_, i) => `Sentence ${i} of an article that exists to be read aloud and then, eventually, deleted again.`,
).join(" ");

/** Whether the bytes are still on disk, as opposed to whether a row still
 * names them. The gap between those two is the leak. */
function stored(storageKey: string): boolean {
  return existsSync(path.join(STORAGE_DIR, storageKey));
}

describe("podcast episode storage (audit S5)", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  let feedUrl: string;

  /** Stays in the queue window throughout: the control for every eviction
   * assertion, because "deleted the right thing" and "deleted everything" are
   * indistinguishable without one. */
  let staysId: string;
  /** Archived partway through, i.e. out of the queue the feed lists. */
  let archivedId: string;
  /** Trashed partway through. The feed query filters `deletedAt: null`, so its
   * enclosure is unreachable from the moment it is trashed and its bytes are
   * pure loss until something deletes them. */
  let trashedId: string;

  async function poll(): Promise<void> {
    const res = await app.inject({ method: "GET", url: feedUrl });
    expect(res.statusCode).toBe(200);
  }

  async function waitForAudio(articleId: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await prisma.articleAudio.findUnique({ where: { articleId } });
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`No ArticleAudio for ${articleId} within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function saveArticle(title: string) {
    const article = await prisma.article.create({
      data: {
        userId,
        url: `https://example.com/${title.replace(/\W+/g, "-")}-${Date.now()}`,
        title,
        extractionStatus: "SUCCESS",
        extractedText: ARTICLE_TEXT,
        status: "UNREAD",
      },
    });
    return article.id;
  }

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

    staysId = await saveArticle("Stays in the queue");
    archivedId = await saveArticle("Gets archived");
    trashedId = await saveArticle("Gets trashed");

    const feed = await app.inject({
      method: "POST",
      url: "/api/podcast/feed",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    feedUrl = feed.json().url;

    // MAX_GENERATIONS_PER_FETCH is 3, so one poll starts all three.
    await poll();
    await Promise.all([waitForAudio(staysId), waitForAudio(archivedId), waitForAudio(trashedId)]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
    await rm(STORAGE_DIR, { recursive: true, force: true });
  });

  describe("eviction", () => {
    it("stores one file per episode to begin with", async () => {
      for (const id of [staysId, archivedId, trashedId]) {
        const audio = await waitForAudio(id);
        expect(stored(audio.storageKey), audio.storageKey).toBe(true);
        expect(audio.bytes).toBeGreaterThan(44);
      }
    });

    it("deletes the row and the bytes for an article that has left the window", async () => {
      const archived = await waitForAudio(archivedId);
      const trashed = await waitForAudio(trashedId);

      // The two ordinary ways an article stops being advertised: read to the
      // end (archived, so out of the queue filter) and thrown away (trashed,
      // so out of every filter).
      await prisma.article.update({ where: { id: archivedId }, data: { status: "ARCHIVED" } });
      await prisma.article.update({ where: { id: trashedId }, data: { deletedAt: new Date() } });

      await poll();

      expect(await prisma.articleAudio.findUnique({ where: { articleId: archivedId } })).toBeNull();
      expect(await prisma.articleAudio.findUnique({ where: { articleId: trashedId } })).toBeNull();
      // The half that was actually leaking: before S5 the rows were never
      // deleted either, but a fix that deletes only rows leaves these true
      // forever and unreachable.
      expect(stored(archived.storageKey), "archived episode's bytes").toBe(false);
      expect(stored(trashed.storageKey), "trashed episode's bytes").toBe(false);
    });

    it("leaves an article still in the window completely alone", async () => {
      const audio = await prisma.articleAudio.findUnique({ where: { articleId: staysId } });
      expect(audio).not.toBeNull();
      expect(stored(audio!.storageKey)).toBe(true);

      // Not just surviving one pass: polling repeatedly must be idempotent,
      // or a client polling every few hours would delete and regenerate the
      // same episode forever.
      await poll();
      await poll();

      const after = await prisma.articleAudio.findUnique({ where: { articleId: staysId } });
      expect(after).toMatchObject({ storageKey: audio!.storageKey, bytes: audio!.bytes });
      expect(after!.generatedAt.getTime()).toBe(audio!.generatedAt.getTime());
      expect(stored(audio!.storageKey)).toBe(true);
    });

    it("answers a request for an evicted enclosure with come-back-later, not gone", async () => {
      // The race eviction accepts: a client holding an older feed document
      // starts downloading an episode that has since left the window. Only
      // ArticleAudio is deleted, so this lands on the route's existing
      // not-yet-generated branch -- 503 + Retry-After, which clients retry --
      // rather than a 404, which they record as permanently failed.
      const token = new URL(feedUrl).pathname.split("/")[2];
      const res = await app.inject({ method: "GET", url: `/podcast/${token}/episodes/${archivedId}/audio.wav` });

      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBeDefined();
    });
  });

  describe("turning the feed off", () => {
    it("takes the stored audio with it, since no poll will ever come to evict it", async () => {
      const before = await prisma.articleAudio.findMany({ where: { article: { userId } } });
      expect(before.length).toBeGreaterThan(0);

      const off = await app.inject({
        method: "DELETE",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(off.statusCode).toBe(204);

      // Read the outcome, then put the feed back before asserting on it: the
      // tests below need a live feed, and a failure here should stay one
      // failure rather than becoming four.
      const rows = await prisma.articleAudio.findMany({ where: { article: { userId } } });
      const survivingFiles = before.filter((row) => stored(row.storageKey)).map((row) => row.storageKey);

      // A fresh URL -- the old one is revoked, not restored.
      const on = await app.inject({
        method: "POST",
        url: "/api/podcast/feed",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      feedUrl = on.json().url;
      await poll();
      await waitForAudio(staysId);

      expect(rows).toHaveLength(0);
      expect(survivingFiles).toEqual([]);
    });
  });

  describe("the per-account quota", () => {
    let ballastId: string;
    let ballastKey: string;
    let hungryId: string;

    beforeAll(async () => {
      // A single row claiming the whole quota, pointing at a real file. Exactly
      // the limit rather than over it, because the check is `used >= quota` and
      // the boundary is the part worth pinning.
      ballastId = await saveArticle("Already using the whole quota");
      ballastKey = await saveFile(userId, `${ballastId}.wav`, pcm16Wav(64));
      await prisma.articleAudio.create({
        data: {
          articleId: ballastId,
          storageKey: ballastKey,
          bytes: QUOTA_BYTES,
          durationSeconds: 1,
          // Current voice and speed, so the feed considers this episode ready
          // and never tries to rebuild it -- the only thing under test is
          // whether a *new* episode is refused.
          voice: process.env.PODCAST_VOICE ?? "af_heart",
          speed: 1,
        },
      });

      hungryId = await saveArticle("Wants to be generated");
    });

    it("refuses to generate, and spends no TTS work finding out", async () => {
      generateSpeechPooled.mockClear();

      await poll();
      // No positive signal to wait for -- the assertion is an absence -- so
      // this is a generous multiple of how long a mocked eight-chunk episode
      // takes to build, and the test below proves the absence is the quota
      // rather than the clock.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(await prisma.articleAudio.findUnique({ where: { articleId: hungryId } })).toBeNull();
      // Checked before the first chunk, not after assembling forty minutes of
      // audio and discovering there is nowhere to put it.
      expect(generateSpeechPooled).not.toHaveBeenCalled();
    });

    it("does not touch, rewrite or delete any audio that already exists", async () => {
      const ballast = await prisma.articleAudio.findUnique({ where: { articleId: ballastId } });
      expect(ballast).toMatchObject({ storageKey: ballastKey, bytes: QUOTA_BYTES });
      expect(stored(ballastKey)).toBe(true);

      // Nothing was evicted to make room either: freeing space by deleting
      // episodes the feed is still advertising is not a decision being over
      // quota authorises.
      const stays = await prisma.articleAudio.findUnique({ where: { articleId: staysId } });
      expect(stays).not.toBeNull();
      expect(stored(stays!.storageKey)).toBe(true);
    });

    it("resumes as soon as there is room, so the refusal is a pause and not a dead end", async () => {
      await prisma.articleAudio.delete({ where: { articleId: ballastId } });

      await poll();
      const audio = await waitForAudio(hungryId);

      expect(stored(audio.storageKey)).toBe(true);
      expect(generateSpeechPooled).toHaveBeenCalled();
    });
  });
});
