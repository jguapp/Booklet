import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Liveness vs readiness (S3).
 *
 * The database is stubbed rather than real here on purpose: the case that
 * matters is the one where Postgres is *not* answering -- rotated
 * credentials, an exhausted pool, a network partition -- and there is no way
 * to produce that against the real dev database from inside the suite. The
 * happy path is covered too, so "always 503" cannot pass this file either.
 */

const queryRaw = vi.fn();

/** Any prisma call other than the readiness probe is a bug in this test's
 * assumptions, not something to silently stub. */
const prismaStub = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    if (prop === "$queryRaw") return queryRaw;
    if (typeof prop === "symbol" || prop === "then") return undefined;
    return () => {
      throw new Error(`readiness test did not expect prisma.${String(prop)}()`);
    };
  },
});

vi.mock("../lib/prisma.js", () => ({ prisma: prismaStub }));

const { buildApp } = await import("../app.js");

describe("/api/ready", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("runs a real query and reports ready", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await app.inject({ method: "GET", url: "/api/ready" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ready");
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the database refuses the connection", async () => {
    // The shape of a rotated password or an exhausted pool: the process is
    // fine, every real request is not.
    queryRaw.mockRejectedValue(new Error('password authentication failed for user "booklet"'));

    const res = await app.inject({ method: "GET", url: "/api/ready" });

    expect(res.statusCode).toBe(503);
    expect(res.json().status).not.toBe("ready");
  });

  it("does not leak the database error to an unauthenticated caller", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.3.14:5432"));

    const res = await app.inject({ method: "GET", url: "/api/ready" });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("10.0.3.14");
  });

  it("gives up on a hung database instead of hanging with it", async () => {
    // A pool with no free connections does not reject, it waits -- and an
    // orchestrator's own health timeout is what would fire instead, which
    // reads as "probe misconfigured" rather than "database unreachable".
    queryRaw.mockImplementation(() => new Promise(() => {}));

    const started = Date.now();
    const res = await app.inject({ method: "GET", url: "/api/ready" });

    expect(res.statusCode).toBe(503);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 15000);
});

describe("/api/health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("stays process-local, so a liveness probe never restarts the fleet over a database blip", async () => {
    queryRaw.mockReset();
    queryRaw.mockRejectedValue(new Error("database is down"));

    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
