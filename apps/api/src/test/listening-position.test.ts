import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Cross-device listening position (#152).
 *
 * The feature shipped without any coverage, which matters more here than it
 * looks: the whole point is that a position written on one device shows up on
 * another, and nothing about a single-device manual test can tell you whether
 * that works or whether you are just reading back your own local state.
 *
 * These go through app.inject rather than the browser for exactly that reason
 * -- two requests carrying different device ids against one account is what a
 * second device *is*, as far as this API is concerned, and it needs no second
 * browser to express.
 *
 * The bounds cases are here because the columns are client-supplied and this
 * route is authenticated but not otherwise constrained: a fraction outside
 * 0-1 would render as a nonsense resume offer, and an unbounded device id is
 * a string this server stores forever without ever interpreting.
 */

const TEST_EMAIL = `listening-${Date.now()}@test.local`;
const TEST_PASSWORD = "hunter22222";

describe("listening position", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let articleId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    accessToken = signup.json().accessToken;

    const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL } });
    const article = await prisma.article.create({
      data: {
        userId: user.id,
        title: "Listening fixture",
        extractedText: "some text to listen to",
        sourceType: "HTML",
        extractionStatus: "SUCCESS",
      },
    });
    articleId = article.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
  });

  function patch(payload: Record<string, unknown>) {
    return app.inject({
      method: "PATCH",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });
  }

  it("stores a position and hands it to a different device", async () => {
    const written = await patch({ listeningFraction: 0.42, listeningDeviceId: "phone-1" });
    expect(written.statusCode).toBe(200);

    // The same account asking again *is* the second device here.
    const read = await app.inject({
      method: "GET",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = read.json();
    expect(body.listeningFraction).toBeCloseTo(0.42);
    expect(body.listeningDeviceId).toBe("phone-1");
    // Needed to tell "paused here a moment ago" from "paused here last month",
    // and to attribute the position to a device at all.
    expect(body.listeningUpdatedAt).toBeTypeOf("string");
  });

  it("lets the last writer win across devices, and says which one it was", async () => {
    await patch({ listeningFraction: 0.2, listeningDeviceId: "phone-1" });
    const first = await app.inject({
      method: "GET",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    await patch({ listeningFraction: 0.8, listeningDeviceId: "laptop-2" });
    const second = await app.inject({
      method: "GET",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    // Deliberate last-write-wins: there is no correct reconciliation of two
    // simultaneous positions, so the newest is as good an answer as exists.
    expect(second.json().listeningFraction).toBeCloseTo(0.8);
    expect(second.json().listeningDeviceId).toBe("laptop-2");
    expect(new Date(second.json().listeningUpdatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.json().listeningUpdatedAt).getTime(),
    );
  });

  it("stamps its own time rather than trusting the client's clock", async () => {
    const before = Date.now();
    await patch({ listeningFraction: 0.5, listeningDeviceId: "phone-1", listeningUpdatedAt: "1999-01-01T00:00:00Z" });
    const read = await app.inject({
      method: "GET",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // A device with a wrong or lying clock must not get to decide what "most
    // recent" means for every other device.
    expect(new Date(read.json().listeningUpdatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("leaves the position alone when a request does not mention it", async () => {
    await patch({ listeningFraction: 0.33, listeningDeviceId: "phone-1" });
    // A status change is the common case -- it must not silently clear where
    // the user had got to.
    await patch({ status: "READING" });

    const read = await app.inject({
      method: "GET",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(read.json().listeningFraction).toBeCloseTo(0.33);
    expect(read.json().listeningDeviceId).toBe("phone-1");
  });

  it.each([
    ["above 1", { listeningFraction: 1.5 }],
    ["below 0", { listeningFraction: -0.1 }],
    ["not a number", { listeningFraction: "half" }],
  ])("rejects a fraction %s", async (_label, payload) => {
    const res = await patch(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_listening_position");
  });

  it.each([
    ["empty", { listeningFraction: 0.5, listeningDeviceId: "  " }],
    ["over 64 characters", { listeningFraction: 0.5, listeningDeviceId: "d".repeat(65) }],
    ["not a string", { listeningFraction: 0.5, listeningDeviceId: 7 }],
  ])("rejects a device id that is %s", async (_label, payload) => {
    const res = await patch(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_device_id");
  });

  it("does not expose another account's position", async () => {
    const other = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: `listening-other-${Date.now()}@test.local`, password: TEST_PASSWORD },
    });
    const otherToken = other.json().accessToken;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/articles/${articleId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { listeningFraction: 0.9, listeningDeviceId: "attacker" },
    });
    expect(res.statusCode).toBe(404);

    await prisma.user.deleteMany({ where: { email: { startsWith: "listening-other-" } } });
  });
});
