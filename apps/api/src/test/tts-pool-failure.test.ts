import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How the pool behaves when a worker dies, which before these tests it mostly
 * did not.
 *
 * Three failures, all confirmed by running the real pool against stand-in
 * workers (see fixtures/) rather than by reading it:
 *
 *  1. A worker whose IPC channel had closed stayed in the pool looking idle,
 *     because only "exit" removed it and Node delivers "disconnect" first.
 *     The next request's send() into that dead channel emitted an "error" the
 *     ChildProcess had no listener for, and an EventEmitter with no "error"
 *     listener rethrows -- "Unhandled 'error' event ... at pump", the whole
 *     API gone. Same shape as #163.
 *  2. stopTtsPool() abandoned in-flight and queued requests instead of
 *     failing them, so on SIGTERM index.ts's drain was left waiting on
 *     something that could never finish.
 *  3. A worker that could not start at all was re-forked as fast as the OS
 *     would fork it, forever.
 *
 * The pool reads TTS_WORKER_ENTRY and TTS_POOL_SIZE at module load, so each
 * case resets the module registry and imports it fresh against its own
 * stand-in worker.
 */

const dir = path.dirname(fileURLToPath(import.meta.url));

type Pool = typeof import("../services/tts-pool.js");

let pool: Pool | null = null;

/**
 * Imports the pool fresh against one stand-in worker, on the production fork
 * path.
 *
 * NODE_ENV is flipped for the import only, and it is not incidental: in dev
 * the pool forks `tsx/cli` and *that* forks the worker, so the channel the
 * pool holds belongs to the wrapper rather than to the worker itself. These
 * cases are about what the pool does with its own child's channel, which is
 * also the arrangement that actually ships.
 */
async function loadPoolWith(workerFixture: string): Promise<Pool> {
  process.env.TTS_WORKER_ENTRY = path.join(dir, "fixtures", workerFixture);
  process.env.TTS_POOL_SIZE = "1";
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    vi.resetModules();
    pool = await import("../services/tts-pool.js");
    return pool;
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  pool?.stopTtsPool();
  pool = null;
});

describe("a TTS worker whose IPC channel has gone (#163 class)", () => {
  it("fails the request rather than taking the API process down", async () => {
    const p = await loadPoolWith("dead-channel-tts-worker.mjs");
    p.warmTtsPool();
    // Ready, then the channel drops while the process stays alive -- the exact
    // state a crashed worker is in between "disconnect" and "exit".
    await settle(1_500);

    // Before the fix this did not fail the assertion, it ended the process:
    // pump() called send() on the closed channel, which scheduled an "error"
    // emit nobody was listening for.
    await expect(p.generateSpeechPooled("a chunk of an article", "af_heart", 1)).rejects.toThrow();
  }, 30_000);
});

describe("shutting the pool down (the drain a deploy depends on)", () => {
  it("fails in-flight and queued requests instead of leaving them pending forever", async () => {
    const p = await loadPoolWith("silent-tts-worker.mjs");
    p.warmTtsPool();
    await settle(1_500);

    // One request occupies the single worker; the second can only be queued.
    const inFlight = p.generateSpeechPooled("the chunk being generated right now", "af_heart", 1);
    const queued = p.generateSpeechPooled("the chunk waiting behind it", "af_heart", 1);
    // Both promises need a rejection handler attached before the pool is
    // stopped, or an unhandled rejection is itself the thing that fails here.
    const outcomes = Promise.allSettled([inFlight, queued]);
    await settle(300);

    // What SIGTERM does today: this module registers its own signal handler,
    // so the workers die while index.ts is still draining HTTP.
    p.stopTtsPool();

    // Before the fix both of these stayed pending forever: `worker.stopped`
    // makes the kill's "exit" a no-op, so nothing settled them, and
    // closeWithTimeout had nothing to wait for that could ever complete.
    const settled = await Promise.race([outcomes, settle(5_000).then(() => null)]);
    expect(settled, "stopTtsPool left requests pending forever").not.toBeNull();
    expect(settled!.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    for (const result of settled!) {
      expect((result as PromiseRejectedResult).reason.message).toMatch(/shut down/i);
    }
  }, 30_000);
});

describe("a TTS worker that cannot start at all", () => {
  it("backs off instead of re-forking as fast as the OS allows", async () => {
    const p = await loadPoolWith("crashing-tts-worker.mjs");

    let respawns = 0;
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("respawning")) respawns++;
    };
    try {
      p.warmTtsPool();
      await settle(5_000);
    } finally {
      console.error = originalError;
    }

    // Measured against this exact fixture before the fix: 76 respawns in this
    // five-second window, and unbounded after it -- a fork and an error line
    // roughly every 65ms for the life of the process. With the 250ms-doubling
    // backoff, five seconds allows four.
    expect(respawns).toBeLessThanOrEqual(6);
    // And it must not have quietly given up -- a crash-looping worker still
    // gets retried, just not in a tight loop.
    expect(respawns).toBeGreaterThan(0);
  }, 30_000);

  it("does not let its backoff outlive the pool and block the next one", async () => {
    const p = await loadPoolWith("crashing-tts-worker.mjs");

    let respawns = 0;
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("respawning")) respawns++;
    };
    try {
      // Long enough for the backoff to get deep: ~5s of consecutive startup
      // deaths leaves a multi-second timer outstanding, which is the state
      // that matters here.
      p.warmTtsPool();
      await settle(5_000);

      p.stopTtsPool();
      respawns = 0;

      // The backoff belonged to the pool that was just torn down. Cancelling
      // it is what makes this pass: while it was merely out-generationed, the
      // count it left behind still satisfied ensureStarted's guard, and the
      // timer itself then declined to spawn -- so between them the next pool
      // could not start until the old backoff elapsed. Restarting is a thing
      // only tests do today, but a teardown that disables the next start is
      // how one test poisons another.
      p.warmTtsPool();
      await settle(1_500);
    } finally {
      console.error = originalError;
    }

    expect(respawns, "the new pool never forked -- the old pool's backoff was still blocking it").toBeGreaterThan(0);
  }, 30_000);
});
