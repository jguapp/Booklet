import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import {
  AUTH_ROW_RETENTION_DAYS,
  maybePurgeExpiredAuthRows,
  purgeExpiredAuthRows,
} from "../services/auth-cleanup.js";

/**
 * The sweep that stops Session, PasswordResetToken and EmailVerificationToken
 * growing without bound (S8).
 *
 * Refresh rotates: every refresh revokes one Session row and inserts another,
 * and nothing ever deleted the revoked one. At ~96 refreshes per active user
 * per day that is ~35k dead rows per user per year on a table whose unique
 * index is probed by the app's most frequent authenticated request -- and it
 * is invisible from the product, because the "signed-in devices" list filters
 * `revokedAt: null` and so shows a clean list over an enormous table.
 *
 * The half of this that is easy to get wrong is the *negative* case. A sweep
 * that also takes recently-revoked rows destroys the only server-side record
 * of "a session existed at this IP, on this user agent, and ended" -- which
 * is the evidence a user needs in the one conversation the sessions list
 * exists for. So the retention window is asserted from both sides here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = `sweep-${Date.now()}@test.local`;

/** Far enough past the window that a slow test run cannot drift across it. */
const LONG_DEAD_MS = (AUTH_ROW_RETENTION_DAYS + 1) * DAY_MS;
/** Dead, but recently enough that it is still history worth keeping. */
const RECENTLY_DEAD_MS = 1 * DAY_MS;

describe("expired auth row sweep", () => {
  let app: FastifyInstance;
  let userId: string;
  let refreshCookie: string;

  const seedSession = async (data: { expiresAt: Date; revokedAt?: Date | null }) => {
    const row = await prisma.session.create({
      data: {
        userId,
        // Not a real token hash -- nothing here ever presents it, and the
        // column only needs to be unique.
        refreshTokenHash: `sweep-test-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        userAgent: "sweep-test",
        ipAddress: "127.0.0.1",
        expiresAt: data.expiresAt,
        revokedAt: data.revokedAt ?? null,
      },
    });
    return row.id;
  };

  const sessionExists = async (id: string) => (await prisma.session.findUnique({ where: { id } })) !== null;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: EMAIL, password: "correct horse battery staple", name: "Sweep" },
    });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === "booklet_refresh")!;
    refreshCookie = `${cookie.name}=${cookie.value}`;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  // First in the file on purpose: the throttle is module state, and this is
  // the one case that needs an unspent one.
  describe("wiring", () => {
    it("runs off a real refresh, which is what guarantees it ever runs at all", async () => {
      const ancient = await seedSession({
        expiresAt: new Date(Date.now() - LONG_DEAD_MS),
        revokedAt: new Date(Date.now() - LONG_DEAD_MS),
      });

      const res = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: refreshCookie } });
      expect(res.statusCode).toBe(200);
      // Rotation invalidated the cookie we sent; later cases here refresh
      // again and need the one it handed back.
      const rotated = res.cookies.find((c) => c.name === "booklet_refresh")!;
      refreshCookie = `${rotated.name}=${rotated.value}`;

      expect(await sessionExists(ancient)).toBe(false);
    });
  });

  describe("what it removes", () => {
    it("deletes a session revoked longer ago than the retention window", async () => {
      const id = await seedSession({
        // Still inside its 30-day TTL: rotation revokes immediately, so this
        // is the exact shape of the row that accumulates.
        expiresAt: new Date(Date.now() + 20 * DAY_MS),
        revokedAt: new Date(Date.now() - LONG_DEAD_MS),
      });
      await purgeExpiredAuthRows();
      expect(await sessionExists(id)).toBe(false);
    });

    it("deletes a never-revoked session that expired longer ago than the window", async () => {
      const id = await seedSession({ expiresAt: new Date(Date.now() - LONG_DEAD_MS) });
      await purgeExpiredAuthRows();
      expect(await sessionExists(id)).toBe(false);
    });

    it("deletes password reset and email verification tokens past the window", async () => {
      const reset = await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash: `sweep-reset-${Date.now()}`,
          expiresAt: new Date(Date.now() - LONG_DEAD_MS),
        },
      });
      const verification = await prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: `sweep-verify-${Date.now()}`,
          expiresAt: new Date(Date.now() - LONG_DEAD_MS),
        },
      });

      await purgeExpiredAuthRows();

      expect(await prisma.passwordResetToken.findUnique({ where: { id: reset.id } })).toBeNull();
      expect(await prisma.emailVerificationToken.findUnique({ where: { id: verification.id } })).toBeNull();
    });
  });

  describe("what it must not remove", () => {
    it("keeps a live session", async () => {
      const id = await seedSession({ expiresAt: new Date(Date.now() + 30 * DAY_MS) });
      await purgeExpiredAuthRows();
      expect(await sessionExists(id)).toBe(true);
    });

    it("keeps a session revoked recently -- the sessions list is a security surface", async () => {
      const id = await seedSession({
        expiresAt: new Date(Date.now() + 29 * DAY_MS),
        revokedAt: new Date(Date.now() - RECENTLY_DEAD_MS),
      });
      await purgeExpiredAuthRows();
      expect(await sessionExists(id)).toBe(true);
    });

    it("keeps a session that expired inside the window", async () => {
      const id = await seedSession({ expiresAt: new Date(Date.now() - RECENTLY_DEAD_MS) });
      await purgeExpiredAuthRows();
      expect(await sessionExists(id)).toBe(true);
    });

    it("keeps an unexpired verification token and a recently expired reset token", async () => {
      const live = await prisma.emailVerificationToken.create({
        data: { userId, tokenHash: `sweep-live-${Date.now()}`, expiresAt: new Date(Date.now() + DAY_MS) },
      });
      const recent = await prisma.passwordResetToken.create({
        data: { userId, tokenHash: `sweep-recent-${Date.now()}`, expiresAt: new Date(Date.now() - RECENTLY_DEAD_MS) },
      });

      await purgeExpiredAuthRows();

      expect(await prisma.emailVerificationToken.findUnique({ where: { id: live.id } })).not.toBeNull();
      expect(await prisma.passwordResetToken.findUnique({ where: { id: recent.id } })).not.toBeNull();
    });

    it("leaves the session the refresh that triggered it just issued", async () => {
      const before = await prisma.session.count({ where: { userId, revokedAt: null } });
      const res = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: refreshCookie } });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === "booklet_refresh")!;
      refreshCookie = `${cookie.name}=${cookie.value}`;

      // Rotation revoked one and issued one, so the live count is unchanged
      // rather than reduced -- a sweep that took the fresh row would sign the
      // caller out on the very request that renewed them.
      expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(before);
      const stillWorks = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: { cookie: refreshCookie },
      });
      expect(stillWorks.statusCode).toBe(200);
    });
  });

  describe("throttling", () => {
    it("sweeps at most once per interval, so the busiest route pays for it once", async () => {
      // Forced, so this assertion does not depend on how much of the interval
      // the tests above have already spent.
      expect(await maybePurgeExpiredAuthRows(0)).not.toBeNull();
      expect(await maybePurgeExpiredAuthRows()).toBeNull();
    });

    it("reports a failure instead of swallowing it, and does not throw at the caller", async () => {
      const errors: unknown[] = [];
      const boom = new Error("sweep exploded");
      const failing = async () => {
        throw boom;
      };
      const original = prisma.session.deleteMany;
      (prisma.session as { deleteMany: unknown }).deleteMany = failing;
      try {
        expect(await maybePurgeExpiredAuthRows(0, (err) => errors.push(err))).toBeNull();
      } finally {
        (prisma.session as { deleteMany: unknown }).deleteMany = original;
      }
      expect(errors).toEqual([boom]);
    });
  });
});
