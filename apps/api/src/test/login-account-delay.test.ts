import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/auth/password.js";

/**
 * Pins the per-account half of the login bound (#170).
 *
 * The per-IP limit alone was the wrong unit of account in both directions: it
 * locked out everyone behind a shared NAT after ten failures between them,
 * while an attacker with a list of addresses was barely slowed. The fix moves
 * the real bound onto the account, so these tests deliberately vary the
 * source address -- an assertion that only holds from one IP would pass just
 * as well against the old per-IP limiter and prove nothing.
 *
 * Users are created through prisma rather than the signup route so nothing
 * here spends the signup budget, and every email is unique per run so a
 * previous run's leftover strikes cannot make a test pass or fail.
 */
const PREFIX = `login-delay-${Date.now()}`;
const PASSWORD = "correct-horse-battery";
const WRONG = "definitely-not-the-password";

describe("per-account failed-login delay", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app.close();
  });

  async function createUser(label: string): Promise<string> {
    const email = `${PREFIX}-${label}@test.local`;
    await prisma.user.create({ data: { email, passwordHash: hashPassword(PASSWORD) } });
    return email;
  }

  function login(email: string, password: string, ip: string): Promise<InjectResponse> {
    return app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
      remoteAddress: ip,
    });
  }

  /** Six wrong guesses, each from a different address. Returns the last reply. */
  async function burnBudget(email: string): Promise<{ codes: number[]; last: InjectResponse }> {
    const codes: number[] = [];
    let last!: InjectResponse;
    for (let i = 0; i < 6; i++) {
      last = await login(email, WRONG, `198.51.100.${i + 1}`);
      codes.push(last.statusCode);
    }
    return { codes, last };
  }

  it("bounds guessing against one account however many addresses it comes from", async () => {
    const email = await createUser("many-ips");

    const { codes, last } = await burnBudget(email);
    // Six distinct source IPs: under the per-IP limit alone every one of
    // these is a free guess, and an attacker with a proxy list has as many
    // free guesses as they care to pay for.
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toBe("too_many_attempts");
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);

    // A wait an attacker can step over by guessing right is not a bound, so
    // the correct password waits too -- from a seventh, untouched address.
    const correct = await login(email, PASSWORD, "198.51.100.99");
    expect(correct.statusCode).toBe(429);
  });

  it("clears the account's strikes on a successful sign-in", async () => {
    const email = await createUser("reset-on-success");
    // Each request from its own address, as in the test above: eleven from one
    // IP would eventually draw a 429 out of the per-IP limiter instead, which
    // is a green test that proves nothing about the per-account counter.
    const ip = (n: number) => `203.0.113.${n}`;

    for (let i = 0; i < 4; i++) {
      expect((await login(email, WRONG, ip(i + 1))).statusCode).toBe(401);
    }
    expect((await login(email, PASSWORD, ip(5))).statusCode).toBe(200);

    // A full fresh budget afterwards, not the one strike the pre-success
    // failures would have left: without the reset the second of these crosses
    // the limit, and someone who mistypes twice a week carries the strikes
    // forward until an ordinary Tuesday starts returning 429.
    const after: number[] = [];
    for (let i = 0; i < 5; i++) {
      after.push((await login(email, WRONG, ip(i + 6))).statusCode);
    }
    expect(after).toEqual([401, 401, 401, 401, 401]);
    // ...a fresh budget, not an infinite one.
    expect((await login(email, WRONG, ip(11))).statusCode).toBe(429);
  });

  it("delays an email with no account identically, so the wait can't enumerate accounts", async () => {
    const registered = await createUser("enumeration-real");
    const unregistered = `${PREFIX}-enumeration-absent@test.local`;

    const real = (await burnBudget(registered)).last;
    const absent = (await burnBudget(unregistered)).last;

    // Same threshold, same status, same body, same header: if the delay
    // applied only to real accounts, six wrong guesses would answer "is this
    // address registered?" -- the exact question the shared
    // invalid_credentials response exists to refuse.
    expect(real.statusCode).toBe(429);
    expect(absent.statusCode).toBe(429);
    expect(absent.json()).toEqual(real.json());
    expect(absent.headers["retry-after"]).toBe(real.headers["retry-after"]);
  });

  it("leaves everyone else behind the same address able to sign in", async () => {
    const shared = "192.0.2.50";
    const unlucky = await createUser("shared-unlucky");
    const neighbourA = await createUser("shared-neighbour-a");
    const neighbourB = await createUser("shared-neighbour-b");

    for (let i = 0; i < 6; i++) {
      await login(unlucky, WRONG, shared);
    }
    expect((await login(unlucky, WRONG, shared)).statusCode).toBe(429);

    // The whole point of #170: one person exhausting their own budget must
    // not be an outage for the office, the campus, or the carrier NAT.
    expect((await login(neighbourA, PASSWORD, shared)).statusCode).toBe(200);
    expect((await login(neighbourB, PASSWORD, shared)).statusCode).toBe(200);
    // Including a neighbour who mistypes -- they get their own budget, not
    // whatever is left of someone else's.
    expect((await login(neighbourA, WRONG, shared)).statusCode).toBe(401);
  });
});
