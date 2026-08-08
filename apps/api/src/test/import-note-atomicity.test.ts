import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * The one phase boundary in POST /api/sync/import that a retry cannot repair
 * (S1, second half).
 *
 * The audit asked whether the route's five unbatched write phases should be
 * one transaction. Mostly no -- see the long note in routes/sync.ts -- because
 * each phase is idempotent and the client re-sends a batch it never got an
 * answer for, so an interruption costs a retry rather than data. Highlights
 * and their notes are the exception, and the reason is the dedupe that makes
 * everything else safe: on the retry those highlights already exist, so they
 * are skipped, so the pass that writes notes has nothing to iterate and the
 * note is never written by anything again. The highlight is present and looks
 * fine; only the text the reader typed underneath it is gone.
 *
 * The failure is injected with a NUL byte in the note, because Postgres
 * refuses one in a text column. That gives a real, payload-driven failure at
 * exactly the phase boundary under test -- the same shape as the dropped
 * connection the audit described, without mocking the client out from under
 * the code being tested.
 */

const EMAIL = `note-atomicity-${Date.now()}@test.local`;
const NUL = String.fromCharCode(0);

describe("import: highlights and their notes commit together", () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  const savedAt = new Date("2026-01-02T03:04:05.006Z").toISOString();

  const payload = (noteText: string) => ({
    articles: [
      {
        localId: "art-1",
        url: "https://example.com/note-atomicity",
        title: "Note atomicity",
        sourceType: "HTML",
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
        localArticleId: "art-1",
        selectedText: "the passage the note hangs off",
        position: { type: "text", exact: "the passage", prefix: "", suffix: "", start: 0, end: 11 },
        color: "YELLOW",
        noteText,
      },
    ],
  });

  const send = (noteText: string) =>
    app.inject({
      method: "POST",
      url: "/api/sync/import",
      headers: { authorization: `Bearer ${token}` },
      payload: payload(noteText),
    });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: EMAIL, password: "correct horse battery staple", name: "Notes" },
    });
    token = res.json().accessToken;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  it("leaves no orphan highlight behind when the note insert fails", async () => {
    const failed = await send(`a note the database will refuse${NUL}`);
    expect(failed.statusCode).toBe(500);

    // Not "the note is missing" -- the highlight must be missing too. A
    // highlight that survives its own note is what makes the loss permanent,
    // because the retry below then dedupes it away.
    expect(await prisma.highlight.count({ where: { userId } })).toBe(0);
  });

  it("recovers the highlight and the note on the retry the client would send", async () => {
    const retried = await send("a note the database will accept");
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ importedHighlights: 1 });

    const highlights = await prisma.highlight.findMany({ where: { userId }, include: { annotation: true } });
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.annotation?.noteText).toBe("a note the database will accept");
  });

  it("still creates the article once, since that phase deduped as designed", async () => {
    // The article was committed by the first, failed request and skipped by
    // the second -- exactly the partial progress the route is built to keep,
    // and the reason a whole-route transaction was rejected.
    expect(await prisma.article.count({ where: { userId } })).toBe(1);
  });
});
