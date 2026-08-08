import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Three findings from the pre-deployment audit.
 *
 * The import replay one is the fifth bug found at the same seam -- after
 * #164 (articles), #171 (review schedules), canonicalUrl and #172 (files).
 * That is worth stating in the suite rather than only in a commit message,
 * because the pattern is the finding: this route is the app's central
 * promise, every failure in it has been silent, and each was believed
 * correct until someone looked at one more field.
 */

const EMAIL = `blockers-${Date.now()}@test.local`;

describe("pre-deployment blockers", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: EMAIL, password: "correct horse battery staple", name: "Blockers" },
    });
    token = res.json().accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  describe("replayed import of an article with no URL", () => {
    /**
     * Every uploaded PDF and EPUB, and every Kindle-clippings BOOK, has
     * url: null. The dedupe guard was `if (a.url)`, so all of them were
     * created again on a re-sent batch -- and their highlights with them,
     * because the duplicate lands in the set the highlight dedupe treats as
     * "new, cannot already have highlights".
     */
    const savedAt = new Date("2026-03-04T05:06:07.008Z").toISOString();
    const payload = {
      articles: [
        {
          localId: "book-1",
          url: null,
          title: "A Book With No URL",
          sourceType: "BOOK",
          extractionStatus: "SUCCESS",
          tags: [],
          status: "UNREAD",
          savedAt,
          progressFraction: 0,
          activeReadingSeconds: 0,
          favorited: false,
        },
      ],
      highlights: [
        {
          localArticleId: "book-1",
          selectedText: "a passage from a book with no url",
          position: { type: "text", exact: "a passage", prefix: "", suffix: "", start: 0, end: 9 },
          color: "YELLOW",
        },
      ],
    };

    const send = () =>
      app.inject({ method: "POST", url: "/api/sync/import", headers: { authorization: `Bearer ${token}` }, payload });

    it("creates it once and skips it on replay, exactly as a URL-bearing one does", async () => {
      const first = await send();
      expect(first.json()).toMatchObject({ importedArticles: 1, importedHighlights: 1 });

      const replay = await send();
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ importedArticles: 0, skippedArticles: 1, importedHighlights: 0 });

      const rows = await prisma.article.findMany({
        where: { title: "A Book With No URL" },
        include: { highlights: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.highlights).toHaveLength(1);
    });

    it("still treats two genuinely different books as different", async () => {
      // The dedupe key must not be so loose that distinct uploads collapse.
      const other = {
        ...payload,
        articles: [{ ...payload.articles[0]!, localId: "book-2", title: "A Different Book" }],
        highlights: [],
      };
      const res = await app.inject({
        method: "POST",
        url: "/api/sync/import",
        headers: { authorization: `Bearer ${token}` },
        payload: other,
      });
      expect(res.json()).toMatchObject({ importedArticles: 1 });
      expect(await prisma.article.count({ where: { title: "A Different Book" } })).toBe(1);
    });
  });

  describe("unauthenticated file extraction is bounded", () => {
    /**
     * The route stays open on purpose -- local/anonymous mode is a real
     * feature and a reader who never signs up still uploads books. So the
     * bound is size and concurrency, not auth.
     */
    it("refuses a file past the anonymous size limit rather than truncating it", async () => {
      // 30MB of zeroes, past the 25MB cap. Before the fix, @fastify/multipart
      // truncated at the *global* 100MB limit and this went straight into
      // pdf.js.
      const big = Buffer.alloc(30 * 1024 * 1024);
      const boundary = "----blockertest";
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

      const res = await app.inject({
        method: "POST",
        url: "/api/extract-file",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([head, big, tail]),
      });

      // 413 from the explicit truncation check. Not a 422 "not a valid PDF",
      // which is what a silently truncated upload produced and is a
      // confusing way to say "too big".
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe("file_too_large");
    });

    it("still accepts a small file, so the bound has not closed the feature", async () => {
      const boundary = "----blockertestsmall";
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tiny.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        Buffer.from("not really a pdf"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/extract-file",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
      // 422 -- it got through the bounds and failed on being a fake PDF,
      // which is the correct rejection and proves the size check let it by.
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("extraction_failed");
    });
  });
});

describe("FILE_STORAGE_PATH production guard", () => {
  /**
   * Asserted by re-importing the module under a production env rather than
   * by reading the source, so it is the real module-scope check that is
   * being tested.
   */
  it("refuses to load in production with no path set", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevPath = process.env.FILE_STORAGE_PATH;
    process.env.NODE_ENV = "production";
    delete process.env.FILE_STORAGE_PATH;
    try {
      vi.resetModules();
      await expect(import("../services/storage-service.js")).rejects.toThrow(/FILE_STORAGE_PATH is not set/);
    } finally {
      vi.resetModules();
      process.env.NODE_ENV = prevEnv;
      if (prevPath !== undefined) process.env.FILE_STORAGE_PATH = prevPath;
    }
  });

  it("loads fine in production when the path is set", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevPath = process.env.FILE_STORAGE_PATH;
    process.env.NODE_ENV = "production";
    process.env.FILE_STORAGE_PATH = "/tmp/booklet-guard-check";
    try {
      vi.resetModules();
      const mod = await import("../services/storage-service.js");
      expect(typeof mod.saveFile).toBe("function");
    } finally {
      vi.resetModules();
      process.env.NODE_ENV = prevEnv;
      if (prevPath === undefined) delete process.env.FILE_STORAGE_PATH;
      else process.env.FILE_STORAGE_PATH = prevPath;
    }
  });
});
