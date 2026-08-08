import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

/**
 * Pins the split between the two auth rate limits (#169).
 *
 * `/api/auth/refresh` used to sit on AUTH_ATTEMPT_LIMIT -- the 10-per-15-
 * minutes budget that exists to stop password guessing. But refresh is not a
 * credential attempt; the web app calls it on load and on every access-token
 * expiry, so the app spent the user's password-attempt allowance simply by
 * working. A few tabs, or a dozen reloads inside fifteen minutes, and refresh
 * began returning 429 -- which surfaces as being logged out, on a correct
 * password, having done nothing wrong. The limiter keys on IP, so everyone
 * behind one office NAT or carrier CGNAT shared those ten.
 *
 * It reads as an obscure config detail and behaves like an outage, which is
 * why it gets a test rather than a comment: the failure it produces (an
 * intermittent 429 several requests into an unrelated flow) looks like
 * flakiness from every angle except this one. It is what the e2e suite was
 * actually hitting.
 *
 * These drive the limiter rather than introspecting the config. Fastify's
 * findRoute() returns only the handler, and reading the registered options
 * would mean an onRoute hook installed before buildApp() registers anything
 * -- and would then assert that a constant is wired up, not that the wiring
 * behaves. Every request below is deliberately invalid, so nothing is
 * created and no valid session is spent; @fastify/rate-limit counts on
 * onRequest, before the handler ever runs, so a 400 or a 401 draws down the
 * budget exactly as a real attempt would.
 *
 * The limiter is in-memory and scoped to this app instance (no REDIS_URL in
 * tests), so draining it here cannot leak into another test file.
 */
describe("auth rate limits", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Fires `count` requests and returns the status codes, in order. */
  async function fire(count: number, method: "POST", url: string, payload: object): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < count; i++) {
      const res = await app.inject({ method, url, payload });
      codes.push(res.statusCode);
    }
    return codes;
  }

  it("cuts signup off inside a handful of attempts -- that budget is for credential guessing", async () => {
    // Deliberately invalid: a missing password can't create a user, and the
    // limiter has already counted the request by the time the handler
    // rejects it.
    const codes = await fire(12, "POST", "/api/auth/signup", { email: "rate-limit-probe@test.local" });
    expect(codes).toContain(429);
    // And it cuts off early -- the point of the tight budget.
    expect(codes.indexOf(429)).toBeLessThanOrEqual(10);
  });

  it("lets refresh run well past that, because it is traffic and not a credential attempt", async () => {
    // No refresh cookie, so every one of these is a 401 -- what matters is
    // that none of them is a 429. Twelve is already more than the old shared
    // budget allowed, and far less than a real multi-tab session makes.
    const codes = await fire(12, "POST", "/api/auth/refresh", {});
    expect(codes).not.toContain(429);
    expect(new Set(codes)).toEqual(new Set([401]));
  });

  it("keeps the password-reset routes on the tight budget", async () => {
    const codes = await fire(12, "POST", "/api/auth/forgot-password", {});
    expect(codes).toContain(429);
  });
});
