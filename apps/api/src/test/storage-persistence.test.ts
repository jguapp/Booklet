import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The two halves of #173, which together are a data-loss bug rather than a
 * tidiness one.
 *
 * Half one: storage-service.ts derived its root from `import.meta.url`, i.e.
 * a directory inside the deployed application. Nothing mounts that, so a
 * redeploy replaced the container filesystem and every uploaded PDF/EPUB and
 * every generated podcast enclosure went with it, while the rows pointing at
 * them survived. Pointing FILE_STORAGE_PATH at a temp directory here is the
 * same mechanism a deployment uses to point it at a mounted disk -- if the
 * variable is ignored, the writes below land back inside the repo and the
 * assertions fail.
 *
 * Half two: deleting an article cascades its ArticleAudio row away, so
 * nothing was left to name the WAV on disk and it stayed there forever.
 * Every route that removes an article is covered, because the leak was
 * per-route, not central.
 */

// Set before app.js is imported: storage-service reads the variable once at
// module load (a path that changes under a running server would strand
// already-written files), so a static import here would resolve the root
// before this line ran.
const STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "booklet-storage-"));
process.env.FILE_STORAGE_PATH = STORAGE_DIR;

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { saveFile, deleteStoredFile, streamStoredFile } = await import("../services/storage-service.js");

const TEST_EMAIL = `vitest-storage-${Date.now()}@test.local`;
const TEST_PASSWORD = "hunter22222";

const TRASH_RETENTION_DAYS = 30;

function stored(key: string): boolean {
  return existsSync(path.join(STORAGE_DIR, key));
}

describe("durable file storage (#173)", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;

  /** An article as an upload plus a generated episode actually leaves it:
   * bytes on disk under Article.fileStorageKey, and a second file under
   * ArticleAudio.storageKey. Written through saveFile rather than fs so the
   * keys are the real production shape (userId/uuid.ext). */
  async function articleWithBothFiles(opts: { deletedAt?: Date } = {}) {
    const fileKey = await saveFile(userId, "book.pdf", Buffer.from("%PDF-1.7 not really a pdf"));
    const article = await prisma.article.create({
      data: {
        userId,
        url: `https://example.com/${randomUUID()}`,
        title: "A book with an episode",
        sourceType: "PDF",
        extractionStatus: "SUCCESS",
        extractedText: "Some extracted text.",
        originalFilename: "book.pdf",
        fileStorageKey: fileKey,
        deletedAt: opts.deletedAt ?? null,
      },
    });
    const audioKey = await saveFile(userId, `${article.id}.wav`, Buffer.from("RIFFfake WAVEfmt "));
    await prisma.articleAudio.create({
      data: {
        articleId: article.id,
        storageKey: audioKey,
        bytes: 17,
        durationSeconds: 1,
        voice: "af_heart",
        speed: 1,
      },
    });

    expect(stored(fileKey)).toBe(true);
    expect(stored(audioKey)).toBe(true);
    return { articleId: article.id, fileKey, audioKey };
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD, name: "Vitest Storage" },
    });
    accessToken = signup.json().accessToken;
    userId = signup.json().user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
    await rm(STORAGE_DIR, { recursive: true, force: true });
  });

  describe("the configured path", () => {
    it("writes under FILE_STORAGE_PATH, not inside the application directory", async () => {
      const key = await saveFile(userId, "Some Book.EPUB", Buffer.from("epub bytes"));

      // The absolute path is the whole point: a deployment sets this to a
      // mounted disk somewhere entirely outside the app's own tree.
      expect(path.isAbsolute(STORAGE_DIR)).toBe(true);
      expect(stored(key)).toBe(true);
      expect(key).toMatch(new RegExp(`^${userId}/[0-9a-f-]+\\.epub$`));

      await deleteStoredFile(key);
      expect(stored(key)).toBe(false);
    });

    it("reads back through the same root", async () => {
      const key = await saveFile(userId, "read-back.pdf", Buffer.from("round trip"));
      const chunks: Buffer[] = [];
      for await (const chunk of streamStoredFile(key)) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe("round trip");
      await deleteStoredFile(key);
    });
  });

  describe("deleting an article", () => {
    it("removes the uploaded file and the generated audio", async () => {
      const { articleId, fileKey, audioKey } = await articleWithBothFiles();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/articles/${articleId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(204);

      expect(stored(fileKey)).toBe(false);
      expect(stored(audioKey)).toBe(false);
    });

    it("removes both when the trash is emptied", async () => {
      const { fileKey, audioKey } = await articleWithBothFiles({ deletedAt: new Date() });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/articles/trash",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(204);

      expect(stored(fileKey)).toBe(false);
      expect(stored(audioKey)).toBe(false);
    });

    it("removes both when trash expires and is purged on the next read", async () => {
      const longAgo = new Date(Date.now() - (TRASH_RETENTION_DAYS + 10) * 24 * 60 * 60 * 1000);
      const { articleId, fileKey, audioKey } = await articleWithBothFiles({ deletedAt: longAgo });

      // Purging is best-effort work the trash view does on the way in --
      // there is no scheduler in this app -- so reading the view is the only
      // way to trigger it.
      const res = await app.inject({
        method: "GET",
        url: "/api/articles?trashed=true",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await prisma.article.findUnique({ where: { id: articleId } })).toBeNull();

      expect(stored(fileKey)).toBe(false);
      expect(stored(audioKey)).toBe(false);
    });
  });
});
