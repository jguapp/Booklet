/**
 * A small pool of real child processes (see tts-worker-process.ts for why
 * not worker_threads), each holding its own Kokoro model instance, so
 * multiple chunks can generate at genuinely the same wall-clock time
 * instead of one at a time. Confirmed by hand this matters: a single
 * process generates sequentially (measured ~4.5-9.8s per ~60-90 char
 * chunk, serialized -- two concurrent requests to one process take ~2x as
 * long as one, not the same), and that serialized cost was regularly
 * *slower* than the resulting audio's own playback duration -- meaning no
 * amount of client-side prefetching could keep the player fed; the
 * shortfall just compounded, chunk after chunk, into exactly the "long
 * pause after every sentence" this pool exists to fix. Three concurrent
 * processes measured at ~1x a single generation's wall-clock time for all
 * three, not 3x -- real parallelism, not just queuing.
 */
import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedSpeech, setCachedSpeech, speechCacheKey } from "./tts-cache.js";

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

// Each worker holds one quantized (q8) 82M-param model in memory --
// moderate, not free, hence configurable rather than scaling with
// however many CPU cores happen to be available. 3 comfortably beats
// real-time for normal narration without assuming a beefy deployment.
const POOL_SIZE = Number(process.env.TTS_POOL_SIZE) || 3;

// Dev runs this file as TypeScript straight from src/ via tsx (same
// pattern as dev-db.ts forking migrate-pglite.ts through tsx/cli, for the
// same reason: no separately-compiled JS to point at yet). Production
// forks the real compiled sibling instead -- build.mjs deliberately
// outputs it flat as dist/tts-worker-process.js (not nested under
// dist/services/), so this path expression is the same shape in both
// cases; only the extension and this module's own on-disk location
// differ between dev (src/services/) and prod (bundled, inlined into
// dist/index.js, whose import.meta.url resolves to dist/ itself).
const workerEntry = path.join(dir, isDev ? "tts-worker-process.ts" : "tts-worker-process.js");

interface PoolWorker {
  proc: ChildProcess;
  busy: boolean;
  /** The request currently assigned to this worker, if any -- needed so a
   * crash (see the "exit" handler below) can reject *that specific*
   * caller instead of leaving its promise hanging forever. */
  currentRequestId: number | null;
}

interface QueuedTask {
  text: string;
  voice: string;
  speed: number;
  resolve: (buffer: Buffer) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  id: number;
  buffer?: Buffer;
  error?: string;
}

let workers: PoolWorker[] = [];
let nextRequestId = 0;
/** Requests someone is actually waiting on right now -- a play in progress. */
const queue: QueuedTask[] = [];
/**
 * Speculative work: audio we think will be wanted shortly, but that nobody is
 * currently blocked on (see the /api/tts/warm route). Drained only when the
 * normal queue is empty, which is what makes warming safe to be generous
 * with -- it can only ever consume capacity that would otherwise sit idle,
 * and can never push back the chunk a listener is actually waiting for.
 *
 * Without this split, warming an article's opening on every reader-open
 * would compete directly with real playback for a pool of three, so
 * speculating would sometimes make the thing it was speculating about
 * slower.
 */
const lowPriorityQueue: QueuedTask[] = [];
const inFlight = new Map<number, { resolve: (buffer: Buffer) => void; reject: (err: Error) => void }>();

function pump(): void {
  for (const worker of workers) {
    if (worker.busy) continue;
    const task = queue.shift() ?? lowPriorityQueue.shift();
    if (!task) return;
    worker.busy = true;
    const id = nextRequestId++;
    inFlight.set(id, task);
    worker.currentRequestId = id;
    worker.proc.send({ id, text: task.text, voice: task.voice, speed: task.speed });
  }
}

function spawnWorker(): PoolWorker {
  const proc = isDev
    ? fork(require.resolve("tsx/cli"), [workerEntry], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] })
    : fork(workerEntry, { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });

  const worker: PoolWorker = { proc, busy: false, currentRequestId: null };

  proc.on("message", (msg: WorkerMessage) => {
    const task = inFlight.get(msg.id);
    if (!task) return;
    inFlight.delete(msg.id);
    if (msg.error) task.reject(new Error(msg.error));
    else if (msg.buffer) task.resolve(Buffer.from(msg.buffer));
    worker.busy = false;
    worker.currentRequestId = null;
    pump();
  });

  // A worker dying mid-generation (native crash, OOM) shouldn't take the
  // rest of the pool down with it -- replace it and let whatever request
  // it was holding fail; the client's own chunk loop already tolerates one
  // chunk failing without aborting the whole article. That request's
  // caller still needs to actually be told it failed, though: without this,
  // a crash left its entry sitting in `inFlight` forever (nothing else was
  // ever going to resolve or reject it), which meant the client's fetch
  // just hung with no error and no timeout -- confirmed by hand this is
  // strictly worse than a slow chunk, since a slow chunk at least
  // eventually finishes.
  proc.on("exit", (code) => {
    console.error(`[tts-pool] worker exited unexpectedly (code ${code}), respawning`);
    if (worker.currentRequestId !== null) {
      const task = inFlight.get(worker.currentRequestId);
      inFlight.delete(worker.currentRequestId);
      task?.reject(new Error("TTS worker process exited unexpectedly."));
    }
    workers = workers.filter((w) => w !== worker);
    workers.push(spawnWorker());
    pump();
  });

  return worker;
}

function ensureStarted(): void {
  if (workers.length === 0) {
    workers = Array.from({ length: POOL_SIZE }, spawnWorker);
  }
}

/** Warms the whole pool at server startup (all workers load their model
 * concurrently) rather than paying for it on the first real request -- see
 * index.ts. */
export function warmTtsPool(): void {
  ensureStarted();
}

/**
 * Requests already being served, keyed identically to the cache. Without
 * this, N concurrent requests for the same chunk all miss the cache (nothing
 * is written until the first one *finishes*), all occupy a worker, and all
 * generate the same audio -- with a pool of 3, three identical requests can
 * consume the entire pool producing one chunk's worth of distinct output.
 *
 * That collision is the normal case, not a rare one: the reader speculatively
 * warms the opening chunks as soon as an article is opened, and the play loop
 * asks for those same chunks the moment play is pressed, so the two race by
 * design. It also covers the same article open in two tabs, or on a phone and
 * a laptop.
 *
 * Note this wraps the L2 lookup as well as generation -- otherwise the
 * duplicate requests would each still pay their own Redis round trip before
 * discovering they were redundant.
 */
const inFlightByKey = new Map<string, Promise<Buffer>>();

export function generateSpeechPooled(
  text: string,
  voice: string,
  speed: number,
  { speculative = false }: { speculative?: boolean } = {},
): Promise<Buffer> {
  const key = speechCacheKey(text, voice, speed);

  // A speculative request that collides with a real one already in flight
  // simply rides along on it -- and, importantly, so does the reverse: a
  // real play-path request for a chunk already being warmed reuses that
  // work instead of queueing a second copy behind it.
  const existing = inFlightByKey.get(key);
  if (existing) return existing;

  const work = (async () => {
    const cached = await getCachedSpeech(text, voice, speed);
    if (cached) return cached;

    ensureStarted();
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      (speculative ? lowPriorityQueue : queue).push({ text, voice, speed, resolve, reject });
      pump();
    });
    setCachedSpeech(text, voice, speed, buffer);
    return buffer;
  })();

  inFlightByKey.set(key, work);
  // Cleared on rejection as well as success -- leaving a failed promise in
  // here would make one transient error permanently sticky for that exact
  // chunk, which is far worse than the duplicate work this map prevents.
  // The `.catch` is only to keep the deletion from surfacing as an unhandled
  // rejection; the original promise's rejection still reaches every caller.
  void work.catch(() => {}).finally(() => inFlightByKey.delete(key));

  return work;
}

function shutdown(): void {
  for (const worker of workers) worker.proc.kill();
}
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
