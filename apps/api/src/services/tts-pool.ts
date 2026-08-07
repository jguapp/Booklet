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
import { withSpan } from "../lib/telemetry.js";
import { getCachedSpeech, setCachedSpeech, speechCacheKey, type CacheTier } from "./tts-cache.js";

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
// TTS_WORKER_ENTRY exists so the pool's own startup behaviour can be tested
// without forking three processes that each download a 90MB model. Test-only
// by convention; nothing in the app ever sets it.
const workerEntry =
  process.env.TTS_WORKER_ENTRY ?? path.join(dir, isDev ? "tts-worker-process.ts" : "tts-worker-process.js");

interface PoolWorker {
  proc: ChildProcess;
  busy: boolean;
  /** The request currently assigned to this worker, if any -- needed so a
   * crash (see the "exit" handler below) can reject *that specific*
   * caller instead of leaving its promise hanging forever. */
  currentRequestId: number | null;
  /** Settles when this worker's model load finishes, either way. Used to
   * stage cold start (see ensureStarted) and to report real readiness on
   * /api/health. Never rejects -- a worker that failed to load is a fact to
   * report, not an error to propagate. */
  ready: Promise<{ ok: boolean; error?: string }>;
  loaded: boolean;
  /** Set when this worker was killed on purpose, so its "exit" isn't treated
   * as a crash and respawned. Per-worker rather than a single module flag:
   * exit events arrive asynchronously, so a pool restarted straight after a
   * shutdown would otherwise see the *previous* pool's exits land after the
   * flag had been cleared, and helpfully respawn workers nobody asked for. */
  stopped: boolean;
}

interface QueuedTask {
  text: string;
  voice: string;
  speed: number;
  resolve: (buffer: Buffer) => void;
  reject: (err: Error) => void;
  /** Called when this task is actually handed to a worker, which is what
   * divides "waiting for capacity" from "generating". */
  onStart: () => void;
}

interface TaskResultMessage {
  id: number;
  buffer?: Buffer;
  error?: string;
}
interface ReadyMessage {
  type: "ready";
  ok: boolean;
  error?: string;
}
type WorkerMessage = TaskResultMessage | ReadyMessage;

function isReadyMessage(msg: WorkerMessage): msg is ReadyMessage {
  return (msg as ReadyMessage).type === "ready";
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
    task.onStart();
    worker.proc.send({ id, text: task.text, voice: task.voice, speed: task.speed });
  }
}

function spawnWorker(): PoolWorker {
  const proc = isDev
    ? fork(require.resolve("tsx/cli"), [workerEntry], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] })
    : fork(workerEntry, { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });

  let settleReady: (result: { ok: boolean; error?: string }) => void = () => {};
  const worker: PoolWorker = {
    proc,
    busy: false,
    currentRequestId: null,
    loaded: false,
    stopped: false,
    ready: new Promise((resolve) => {
      settleReady = resolve;
    }),
  };

  proc.on("message", (msg: WorkerMessage) => {
    if (isReadyMessage(msg)) {
      worker.loaded = msg.ok;
      if (!msg.ok) console.error(`[tts-pool] worker reported a failed model load: ${msg.error}`);
      settleReady({ ok: msg.ok, error: msg.error });
      return;
    }

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
    if (worker.stopped) return; // deliberate shutdown, not a crash
    console.error(`[tts-pool] worker exited unexpectedly (code ${code}), respawning`);
    // A worker that dies before reporting in must still settle its readiness,
    // or a cold start staged behind it (ensureStarted) would wait forever and
    // the pool would be permanently stuck at one worker.
    worker.loaded = false;
    settleReady({ ok: false, error: `worker exited with code ${code}` });
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

/** Set while the staged cold start below is in flight, so a request arriving
 * mid-startup doesn't spawn a second pool on top of the one being built. */
let starting = false;

/**
 * Starts the pool, deliberately in two stages: worker 0 alone, then the rest
 * once it has finished loading its model.
 *
 * All POOL_SIZE workers used to be spawned at the same instant. On a cold
 * transformers.js cache that means every one of them cold-misses and starts
 * downloading the same ~90MB model to the same path, and that cache write is
 * not atomic across processes. It produced a truncated file and a "Protobuf
 * parsing failed" crash in CI -- every worker then failed to load it, so TTS
 * was dead for the entire run while /api/health still cheerfully returned ok
 * (#161). Staging means the download happens exactly once and the other
 * workers read a complete file off disk.
 *
 * This costs nothing on a warm cache (worker 0's load is a fast local read)
 * and nothing meaningful on a cold one either -- the workers were contending
 * for the same download anyway, so serializing the first is not additive.
 *
 * If worker 0 fails to load, the rest are spawned regardless: a broken model
 * is a problem the workers report per-request, and refusing to build the pool
 * would turn it into a permanent one-worker pool for the life of the process.
 */
function ensureStarted(): void {
  if (workers.length > 0 || starting) return;
  starting = true;

  const first = spawnWorker();
  workers = [first];

  if (POOL_SIZE <= 1) {
    starting = false;
    return;
  }

  void first.ready.then(() => {
    // Guard against the first worker having died and been replaced by the
    // exit handler in the meantime -- that path already rebuilt the pool.
    if (!starting) return;
    for (let i = 1; i < POOL_SIZE; i++) workers.push(spawnWorker());
    starting = false;
    pump();
  });
}

/** Warms the pool at server startup rather than making the first real request
 * pay for it -- see index.ts. */
export function warmTtsPool(): void {
  ensureStarted();
}

/** Real readiness, for /api/health. The pool used to have no notion of this:
 * health reported ok while every worker had failed to load a corrupt model
 * and TTS was completely non-functional, which is precisely how #161 went
 * unnoticed for a whole CI run. */
export function ttsPoolStatus(): { started: boolean; workers: number; loaded: number } {
  return {
    started: workers.length > 0,
    workers: workers.length,
    loaded: workers.filter((w) => w.loaded).length,
  };
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
const inFlightByKey = new Map<string, Promise<PooledSpeech>>();

/** Where the time went, for the route's Server-Timing header and the span
 * attributes. Carried back with the audio rather than stashed in a module
 * variable: several chunks are generated concurrently by design (that is the
 * entire point of the pool), so a single "most recent timings" slot would be
 * clobbered by whichever request happened to finish next. */
export interface PooledSpeech {
  buffer: Buffer;
  cacheTier: CacheTier;
  /** Milliseconds spent waiting for a free worker. Zero on a cache hit. */
  queueMs: number;
  /** Milliseconds spent in the worker actually generating. Zero on a hit. */
  generateMs: number;
}

export function generateSpeechWithTimings(
  text: string,
  voice: string,
  speed: number,
  { speculative = false }: { speculative?: boolean } = {},
): Promise<PooledSpeech> {
  const key = speechCacheKey(text, voice, speed);

  // A speculative request that collides with a real one already in flight
  // simply rides along on it -- and, importantly, so does the reverse: a
  // real play-path request for a chunk already being warmed reuses that
  // work instead of queueing a second copy behind it.
  const existing = inFlightByKey.get(key);
  if (existing) return existing;

  const work = withSpan(
    "tts.generate_pooled",
    { "tts.voice": voice, "tts.speed": speed, "tts.text_length": text.length, "tts.speculative": speculative },
    async (span): Promise<PooledSpeech> => {
      const cached = await getCachedSpeech(text, voice, speed);
      span.setAttribute("tts.cache_tier", cached.tier);
      if (cached.buffer) {
        span.setAttribute("tts.audio_bytes", cached.buffer.length);
        return { buffer: cached.buffer, cacheTier: cached.tier, queueMs: 0, generateMs: 0 };
      }

      ensureStarted();
      // Queue wait and generation are recorded separately because they fail
      // for different reasons and are fixed in different places: queue wait
      // means the pool is too small (or warming is taking capacity from real
      // playback), generation means the model itself is slow on this
      // hardware. One end-to-end duration cannot tell those apart -- and it
      // was exactly that ambiguity that let the pool's parallelism shortfall
      // (#162) sit unnoticed until it was measured by hand.
      const enqueuedAt = Date.now();
      let startedAt = enqueuedAt;
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        (speculative ? lowPriorityQueue : queue).push({
          text,
          voice,
          speed,
          resolve,
          reject,
          onStart: () => {
            startedAt = Date.now();
          },
        });
        pump();
      });
      const queueMs = startedAt - enqueuedAt;
      const generateMs = Date.now() - startedAt;
      span.setAttribute("tts.queue_wait_ms", queueMs);
      span.setAttribute("tts.generate_ms", generateMs);
      span.setAttribute("tts.audio_bytes", buffer.length);

      setCachedSpeech(text, voice, speed, buffer);
      return { buffer, cacheTier: cached.tier, queueMs, generateMs };
    },
  );

  inFlightByKey.set(key, work);
  // Cleared on rejection as well as success -- leaving a failed promise in
  // here would make one transient error permanently sticky for that exact
  // chunk, which is far worse than the duplicate work this map prevents.
  // The `.catch` is only to keep the deletion from surfacing as an unhandled
  // rejection; the original promise's rejection still reaches every caller.
  void work.catch(() => {}).finally(() => inFlightByKey.delete(key));

  return work;
}

/** The audio on its own, for callers with no use for the timings (the warm
 * route, the benchmark). Shares the de-duplication map with the timed
 * version, so mixing the two never generates anything twice. */
export function generateSpeechPooled(
  text: string,
  voice: string,
  speed: number,
  options: { speculative?: boolean } = {},
): Promise<Buffer> {
  return generateSpeechWithTimings(text, voice, speed, options).then((result) => result.buffer);
}

/** Kills every worker and forgets the pool, without the exit handler treating
 * it as a crash and respawning. Exported for tests, which need to start and
 * stop the real pool repeatedly; the signal handlers below use it too. */
export function stopTtsPool(): void {
  starting = false;
  for (const worker of workers) {
    worker.stopped = true;
    worker.proc.kill();
  }
  workers = [];
}

function shutdown(): void {
  stopTtsPool();
}
process.on("exit", shutdown);
// Kill the workers on a signal, but deliberately do NOT exit here. These
// handlers used to call process.exit(0) themselves, which made this module --
// whichever one happens to be imported first -- the thing that decides when
// the process dies, and silently cancelled any other shutdown work registered
// later. index.ts owns the exit now (it needs to flush buffered telemetry
// spans first, which is async and cannot survive a synchronous exit); the
// `process.on("exit")` above still covers every other way the process ends.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
