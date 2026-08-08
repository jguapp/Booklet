import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/auth/tokens.js";
import { saveFile } from "../services/storage-service.js";
import {
  MIN_DISTINCT_USERS,
  normalizePassage,
  passageHash,
  recomputePublicHighlightStats,
} from "../services/aggregation-service.js";

/**
 * DELETE /api/auth/me (#174).
 *
 * The point of this file is that it does not take the cascade on trust.
 * `schema.prisma` declares `onDelete: Cascade` on every relation from `User`,
 * and the migration DDL emits `ON DELETE CASCADE` for each of those foreign
 * keys -- but a declaration is not a row count. A relation added later
 * without the annotation, or one whose parent is not itself reachable from
 * User, would leave rows behind and nothing in the schema would look wrong.
 * So every table is queried again *after* the delete, by id, and asserted
 * empty.
 *
 * The two that cannot cascade get the same treatment for the same reason:
 * stored files live outside Postgres entirely, and PublicHighlightStat holds
 * no user ids by design (see aggregation-service.ts), so both are checked
 * against their real backing store rather than inferred from the route
 * having returned 204.
 */

const RUN = Date.now();
const PASSWORD = "hunter22222";
/** Mirrors storage-service.ts's own root resolution, FILE_STORAGE_PATH
 * included (#173) -- hardcoding apps/api/storage here would make this file
 * silently stop checking anything the moment a deployment or a future test
 * environment sets that variable, since existsSync would just be asked about
 * a path nothing ever wrote to. */
const STORAGE_ROOT = path.resolve(
  process.env.FILE_STORAGE_PATH?.trim() ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "storage"),
);

/** Long enough to clear MIN_PASSAGE_CHARS, and distinctive enough that no
 * other suite's data can land in the same aggregate bucket. */
const SHARED_PASSAGE =
  "The library you delete should stop being counted the moment you delete it, says the deletion test.";

function statForSharedPassage() {
  return prisma.publicHighlightStat.findUnique({
    where: { textHash: passageHash(normalizePassage(SHARED_PASSAGE)) },
  });
}

/**
 * Every table that holds anything belonging to a user, counted by whatever
 * column actually ties it back to them. Written out one table at a time,
 * rather than looped over Prisma's model list, so that adding a model and
 * forgetting the cascade shows up here as a missing line a reviewer can see.
 */
async function remainingRows(ids: {
  userId: string;
  articleIds: string[];
  webhookIds: string[];
  highlightIds: string[];
}): Promise<Record<string, number>> {
  const { userId, articleIds, webhookIds, highlightIds } = ids;
  const byUser = { where: { userId } };
  return {
    user: await prisma.user.count({ where: { id: userId } }),
    session: await prisma.session.count(byUser),
    article: await prisma.article.count(byUser),
    highlight: await prisma.highlight.count(byUser),
    annotation: await prisma.annotation.count(byUser),
    collection: await prisma.collection.count(byUser),
    digest: await prisma.digest.count(byUser),
    feed: await prisma.feed.count(byUser),
    apiToken: await prisma.apiToken.count(byUser),
    webhook: await prisma.webhook.count(byUser),
    oAuthAccount: await prisma.oAuthAccount.count(byUser),
    passwordResetToken: await prisma.passwordResetToken.count(byUser),
    emailVerificationToken: await prisma.emailVerificationToken.count(byUser),
    readingActivityDay: await prisma.readingActivityDay.count(byUser),
    share: await prisma.share.count(byUser),
    // These three have no userId of their own -- they hang off an article,
    // a webhook or a highlight, so they only disappear if the cascade is
    // transitive. That is exactly the case a "does User cascade?" reading of
    // the schema does not answer.
    articleCollection: await prisma.articleCollection.count({ where: { articleId: { in: articleIds } } }),
    articleAudio: await prisma.articleAudio.count({ where: { articleId: { in: articleIds } } }),
    webhookDelivery: await prisma.webhookDelivery.count({ where: { webhookId: { in: webhookIds } } }),
    // The implicit Digest<->Highlight join table has no Prisma model to
    // count, so it is checked from the highlight side instead.
    digestHighlightLink: await prisma.highlight.count({ where: { id: { in: highlightIds } } }),
  };
}

describe("account deletion (#174)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: `vitest-delete-${RUN}` } } });
    await recomputePublicHighlightStats();
    await app.close();
  });

  describe("re-authentication", () => {
    it("refuses a request with no session at all", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/auth/me", payload: { password: PASSWORD } });
      expect(res.statusCode).toBe(401);
    });

    it("refuses the wrong password, and leaves the account exactly where it was", async () => {
      const email = `vitest-delete-${RUN}-wrongpw@test.local`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email, password: PASSWORD },
      });
      const token = signup.json().accessToken;
      const userId = signup.json().user.id;

      const res = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: { password: "not-the-password" },
      });
      expect(res.statusCode).toBe(403);
      expect(await prisma.user.count({ where: { id: userId } })).toBe(1);

      // And a missing password is refused the same way -- an empty body must
      // not be a shortcut past the confirmation step.
      const empty = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(empty.statusCode).toBe(403);
      expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    });

    it("takes a typed email instead of a password for an OAuth-only account, which has none", async () => {
      const email = `vitest-delete-${RUN}-oauth@test.local`;
      const user = await prisma.user.create({
        data: {
          email,
          // The defining property of these accounts (see User.passwordHash's
          // own comment): there is nothing to verify a password against, so
          // password re-entry cannot be the confirmation step.
          passwordHash: null,
          oauthAccounts: { create: { provider: "google", providerAccountId: `vitest-${RUN}` } },
        },
      });
      const token = signAccessToken(user.id).token;

      const wrongText = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: { confirmEmail: "delete my account" },
      });
      expect(wrongText.statusCode).toBe(403);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);

      // A password is not an accepted confirmation here either -- there is
      // nothing to compare it against, so accepting one would be accepting
      // anything.
      const password = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: { password: PASSWORD },
      });
      expect(password.statusCode).toBe(403);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);

      const correct = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: { confirmEmail: email },
      });
      expect(correct.statusCode).toBe(204);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    });

    it("will not let a password account delete itself by typing its email", async () => {
      const email = `vitest-delete-${RUN}-pwaccount@test.local`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email, password: PASSWORD },
      });
      const res = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${signup.json().accessToken}` },
        payload: { confirmEmail: email },
      });
      // The email is on screen the whole time someone is signed in; for an
      // account that has a password, re-typing it proves nothing.
      expect(res.statusCode).toBe(403);
      expect(await prisma.user.count({ where: { id: signup.json().user.id } })).toBe(1);
    });
  });

  describe("the whole sequence", () => {
    const email = `vitest-delete-${RUN}-full@test.local`;
    let token: string;
    let userId: string;
    let articleIds: string[];
    let webhookIds: string[];
    let highlightIds: string[];
    let fileKey: string;
    let audioKey: string;
    let articleShareSlug: string;
    let collectionShareSlug: string;
    let survivorId: string;

    beforeAll(async () => {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email, password: PASSWORD, name: "Departing Reader" },
      });
      token = signup.json().accessToken;
      userId = signup.json().user.id;

      // Real bytes on disk, through the same saveFile the upload route uses,
      // so "the file is gone" is checked against the filesystem rather than
      // against a mock that would agree with whatever the route did.
      fileKey = await saveFile(userId, "upload.pdf", Buffer.from("%PDF-1.4 pretend upload"));
      audioKey = await saveFile(userId, "episode.wav", Buffer.from("RIFF pretend audio"));

      const article = await prisma.article.create({
        data: {
          userId,
          url: "https://example.com/departing",
          title: "Something They Saved",
          fileStorageKey: fileKey,
          audio: {
            create: { storageKey: audioKey, bytes: 18, durationSeconds: 1, voice: "af_heart", speed: 1 },
          },
        },
      });
      // A trashed article too: its file is just as orphaned as a live one's
      // if the collection step filters on deletedAt the way every read query
      // in the app does.
      const trashed = await prisma.article.create({
        data: { userId, title: "Already In The Trash", deletedAt: new Date() },
      });
      articleIds = [article.id, trashed.id];

      const highlight = await prisma.highlight.create({
        data: {
          articleId: article.id,
          userId,
          selectedText: SHARED_PASSAGE,
          position: { type: "text" },
          color: "YELLOW",
          annotation: { create: { userId, noteText: "A note nobody else should keep." } },
        },
      });
      highlightIds = [highlight.id];

      await prisma.digest.create({ data: { userId, highlights: { connect: { id: highlight.id } } } });

      const collection = await prisma.collection.create({ data: { userId, name: `Kept ${RUN}` } });
      await prisma.articleCollection.create({ data: { collectionId: collection.id, articleId: article.id } });

      const webhook = await prisma.webhook.create({
        data: { userId, url: "https://example.com/hook", events: ["article.created"], secret: "s3cret" },
      });
      webhookIds = [webhook.id];
      await prisma.webhookDelivery.create({
        data: { webhookId: webhook.id, event: "article.created", statusCode: 200, success: true },
      });

      await prisma.apiToken.create({ data: { userId, name: "Zapier", tokenHash: `vitest-pat-${RUN}` } });
      await prisma.feed.create({ data: { userId, url: "https://example.com/feed.xml" } });
      await prisma.oAuthAccount.create({
        data: { userId, provider: "github", providerAccountId: `vitest-gh-${RUN}` },
      });
      await prisma.passwordResetToken.create({
        data: { userId, tokenHash: `vitest-reset-${RUN}`, expiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.emailVerificationToken.create({
        data: { userId, tokenHash: `vitest-verify-${RUN}`, expiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.readingActivityDay.create({
        data: { userId, date: new Date("2026-01-01T00:00:00.000Z"), seconds: 600 },
      });

      const articleShare = await prisma.share.create({
        data: { userId, articleId: article.id, slug: `vitest-del-a-${RUN}` },
      });
      articleShareSlug = articleShare.slug;
      const collectionShare = await prisma.share.create({
        data: { userId, collectionId: collection.id, slug: `vitest-del-c-${RUN}` },
      });
      collectionShareSlug = collectionShare.slug;

      // The aggregate needs MIN_DISTINCT_USERS accounts on the same passage
      // before it stores anything at all, so the departing account gets
      // enough company to push it over the line -- and one of those stays
      // behind afterwards, to prove the rebuild drops only the leaver.
      await prisma.user.update({ where: { id: userId }, data: { contributesToPublicHighlights: true } });
      for (let i = 0; i < MIN_DISTINCT_USERS - 1; i++) {
        const peer = await prisma.user.create({
          data: {
            email: `vitest-delete-${RUN}-peer-${i}@test.local`,
            passwordHash: "not-a-real-hash",
            contributesToPublicHighlights: true,
          },
        });
        if (i === 0) survivorId = peer.id;
        const peerArticle = await prisma.article.create({
          data: { userId: peer.id, title: "Same Source", url: `https://example.com/peer-${RUN}-${i}` },
        });
        await prisma.highlight.create({
          data: {
            articleId: peerArticle.id,
            userId: peer.id,
            selectedText: SHARED_PASSAGE,
            position: { type: "text" },
            color: "YELLOW",
          },
        });
        await prisma.share.create({
          data: { userId: peer.id, articleId: peerArticle.id, slug: `vitest-del-p-${RUN}-${i}` },
        });
      }
      await recomputePublicHighlightStats();
    });

    it("has everything in place before the delete, so the assertions after it mean something", async () => {
      const before = await remainingRows({ userId, articleIds, webhookIds, highlightIds });
      for (const [table, count] of Object.entries(before)) {
        expect(count, `${table} should have rows before the delete`).toBeGreaterThan(0);
      }
      expect(existsSync(path.join(STORAGE_ROOT, fileKey))).toBe(true);
      expect(existsSync(path.join(STORAGE_ROOT, audioKey))).toBe(true);
      expect((await statForSharedPassage())?.userCount).toBe(MIN_DISTINCT_USERS);
      expect((await app.inject({ method: "GET", url: `/api/public/shares/${articleShareSlug}` })).statusCode).toBe(200);
    });

    it("deletes the account on a correct password", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
        payload: { password: PASSWORD },
      });
      expect(res.statusCode).toBe(204);

      // The refresh cookie is cleared in the same response -- otherwise the
      // browser keeps presenting a credential for an account that no longer
      // exists, and every page load starts with a failed refresh.
      const cleared = res.cookies.find((c) => c.name === "booklet_refresh");
      expect(cleared?.value).toBe("");
    });

    it("leaves no row behind in any table, checked by querying each one", async () => {
      const after = await remainingRows({ userId, articleIds, webhookIds, highlightIds });
      expect(after).toEqual({
        user: 0,
        session: 0,
        article: 0,
        highlight: 0,
        annotation: 0,
        collection: 0,
        digest: 0,
        feed: 0,
        apiToken: 0,
        webhook: 0,
        oAuthAccount: 0,
        passwordResetToken: 0,
        emailVerificationToken: 0,
        readingActivityDay: 0,
        share: 0,
        articleCollection: 0,
        articleAudio: 0,
        webhookDelivery: 0,
        digestHighlightLink: 0,
      });
    });

    it("removes the stored file and the generated audio rather than orphaning them", async () => {
      // Nothing in the database references these keys any more, so if the
      // route did not delete them here nothing ever will.
      expect(existsSync(path.join(STORAGE_ROOT, fileKey))).toBe(false);
      expect(existsSync(path.join(STORAGE_ROOT, audioKey))).toBe(false);
    });

    it("stops counting the departing account in PublicHighlightStat", async () => {
      // No user ids live in that table, so nothing about deleting rows could
      // have updated it -- only the rebuild can. Down to MIN_DISTINCT_USERS-1
      // contributors, the passage falls below the threshold and the row goes
      // entirely, which is the strongest observable form of "no longer
      // counted".
      expect(await statForSharedPassage()).toBeNull();

      // ...and the accounts that stayed are untouched.
      expect(await prisma.user.count({ where: { id: survivorId } })).toBe(1);
    });

    it("404s both shared pages immediately, with no grace period", async () => {
      for (const slug of [articleShareSlug, collectionShareSlug]) {
        const res = await app.inject({ method: "GET", url: `/api/public/shares/${slug}` });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: "not_found", message: "This link isn't available." });
      }
    });

    it("stops honouring the access token that was still valid a moment ago", async () => {
      // The JWT itself is still cryptographically fine -- it has minutes left
      // on it -- so this only holds because the routes behind it look the
      // account up rather than trusting the `sub` claim.
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("frees the email address, so the same person can start over", async () => {
      const again = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email, password: PASSWORD },
      });
      expect(again.statusCode).toBe(201);
      // A brand new account, not a resurrected one.
      expect(again.json().user.id).not.toBe(userId);
    });
  });
});
