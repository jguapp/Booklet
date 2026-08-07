import { afterEach, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * #161: all TTS_POOL_SIZE workers used to be spawned at the same instant, so
 * on a cold transformers.js cache every one of them cold-missed and started
 * downloading the same ~90MB model to the same path. That write is not atomic
 * across processes -- it produced a truncated file and a "Protobuf parsing
 * failed" crash in CI, leaving read-aloud dead for the whole run while
 * /api/health still reported ok.
 *
 * These drive the real tts-pool.ts, pointed at a stand-in worker via
 * TTS_WORKER_ENTRY so the test is about startup sequencing rather than about
 * downloading Kokoro. The stand-in honours the one part of the real worker's
 * contract the staging depends on: send { type: "ready" } once the model load
 * settles, either way.
 */

const dir = path.dirname(fileURLToPath(import.meta.url));

// Set before importing tts-pool -- POOL_SIZE and workerEntry are read at
// module load.
process.env.TTS_WORKER_ENTRY = path.join(dir, "fixtures", "fake-tts-worker.ts");
process.env.TTS_POOL_SIZE = "3";

type Pool = typeof import("../services/tts-pool.js");
let pool: Pool;

beforeAll(async () => {
  pool = await import("../services/tts-pool.js");
});

afterEach(() => {
  pool.stopTtsPool();
});

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for pool state");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("staged pool cold start (#161)", () => {
  it("starts one worker first and the rest only once it has loaded", async () => {
    process.env.FAKE_TTS_LOAD_MS = "500";
    pool.warmTtsPool();

    // The property that prevents the race: while worker 0 is still loading,
    // no other process exists to be downloading the same file. Before the
    // fix this was 3 immediately.
    expect(pool.ttsPoolStatus()).toMatchObject({ started: true, workers: 1, loaded: 0 });

    await waitFor(() => pool.ttsPoolStatus().workers === 3);
    await waitFor(() => pool.ttsPoolStatus().loaded === 3);
  }, 40_000);

  it("still starts the remaining workers when the first fails to load", async () => {
    // A broken model must not leave a permanent one-worker pool for the life
    // of the process -- the workers report the failure per-request instead.
    process.env.FAKE_TTS_LOAD_MS = "-1";
    pool.warmTtsPool();

    expect(pool.ttsPoolStatus().workers).toBe(1);
    await waitFor(() => pool.ttsPoolStatus().workers === 3);
    expect(pool.ttsPoolStatus().loaded).toBe(0);
  }, 40_000);

  it("reports readiness so health can tell 'up' from 'read-aloud actually works'", async () => {
    expect(pool.ttsPoolStatus()).toEqual({ started: false, workers: 0, loaded: 0 });

    process.env.FAKE_TTS_LOAD_MS = "0";
    pool.warmTtsPool();
    await waitFor(() => pool.ttsPoolStatus().loaded === 3);
    expect(pool.ttsPoolStatus()).toEqual({ started: true, workers: 3, loaded: 3 });
  }, 40_000);

  it("does not build a second pool if a request arrives mid-startup", async () => {
    process.env.FAKE_TTS_LOAD_MS = "400";
    pool.warmTtsPool();
    pool.warmTtsPool();
    pool.warmTtsPool();
    expect(pool.ttsPoolStatus().workers).toBe(1);

    await waitFor(() => pool.ttsPoolStatus().workers === 3);
    // Not 9.
    expect(pool.ttsPoolStatus().workers).toBe(3);
  }, 40_000);
});
