import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, closeWithTimeout } from "../app.js";

/**
 * The drain half of SIGTERM handling (S4).
 *
 * index.ts itself cannot be imported by a test -- it listens on a real port
 * and warms the TTS pool on import -- so what is asserted here is the helper
 * its signal handler awaits. Two properties, and they pull against each
 * other: a request already being served must finish, and one stuck request
 * must not be able to hold a deploy open forever.
 */
describe("closeWithTimeout", () => {
  it("lets an in-flight request finish instead of dropping the connection", async () => {
    // The real buildApp, not a bare Fastify instance: whether a response
    // survives close() depends on the server options buildApp sets
    // (forceCloseConnections), so a hand-rolled app here would pass while
    // production still severed the connection.
    const app = await buildApp();
    let handlerFinished = false;
    app.get("/slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      handlerFinished = true;
      return { ok: true };
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");

    const inFlight = fetch(`http://127.0.0.1:${address.port}/slow`);
    // Let the handler actually start; closing before the socket exists would
    // prove nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const outcome = await closeWithTimeout(app, 5000);
    const response = await inFlight;

    expect(outcome).toBe("closed");
    expect(handlerFinished).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns rather than waiting forever when close never resolves", async () => {
    // A websocket-ish or slow-loris connection that never goes idle: without
    // a ceiling the platform's own kill timer becomes the shutdown path, i.e.
    // exactly the dropped-connection behaviour this replaced.
    const stuck = {
      close: () => new Promise<void>(() => {}),
      log: { error: () => {}, warn: () => {}, info: () => {} },
    } as unknown as FastifyInstance;

    const started = Date.now();
    const outcome = await closeWithTimeout(stuck, 100);

    expect(outcome).toBe("timed-out");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reports a failed close instead of throwing, so telemetry still gets flushed", async () => {
    const broken = {
      close: () => Promise.reject(new Error("server was never listening")),
      log: { error: () => {}, warn: () => {}, info: () => {} },
    } as unknown as FastifyInstance;

    await expect(closeWithTimeout(broken, 1000)).resolves.toBe("failed");
  });
});
