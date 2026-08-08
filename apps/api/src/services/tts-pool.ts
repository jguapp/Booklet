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
 * pause after every sentence" this pool exists to fix.
 *
 * This header used to claim, flatly, that three concurrent processes finish
 * in ~1x a single generation's wall-clock time. That was measured on a
 * developer machine with cores to spare, and stated without saying so. The
 * first real CI benchmark, on a 2-vCPU runner, measured 2.86x -- very nearly
 * fully serialized (#162). The pool was not providing the parallelism this
 * comment promised, because each worker created its ONNX session with no
 * options and therefore sized its intra-op thread pool to the whole machine:
 * three processes each trying to use every core, on two cores, is
 * contention, not concurrency.
 *
 * Two things follow, and both are now done rather than assumed: the pool is
 * sized from real cores (see POOL_SIZE below), and each worker's session is
 * given an explicit thread budget (see tts-service.ts's intraOpThreads).
 * The benchmark prints the host's core count and the concurrency ratio, so
 * the claim is a measurement with a context attached rather than folklore.
 */
import { fork, type ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSpan } from "../lib/telemetry.js";
import { getCachedSpeech, setCachedSpeech, speechCacheKey, type CacheTier } from "./tts-cache.js";

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

// Each worker holds one quantized (q8) 82M-param model in memory --
// moderate, not free -- and, more importantly, competes for CPU with every
// other worker. A fixed 3 was wrong on a small host: on a 2-vCPU runner
// three workers each sized their ONNX intra-op pool to the whole machine
// and three concurrent generations took 2.86x a single one rather than the
// ~1x the header claimed (#162). Sizing from real cores, and capping at
// them, is what keeps a "pool" from being a queue with extra memory.
//
// Capped at 3 above that: beyond three concurrent chunks the player has
// nothing useful to do with the extra capacity (it reads ahead a bounded
// number of chunks), so more workers would only cost memory.
const MAX_POOL_SIZE = 3;
/** Exported so the benchmark can report the pool it actually measured --
 * the numbers are meaningless without it (#162). */
export const POOL_SIZE =
  Number(process.env.TTS_POOL_SIZE) || Math.max(1, Math.min(MAX_POOL_SIZE, availableParallelism()));

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
  /** Set by retireWorker, so the three separate events that all mean "this
   * worker is gone" ("disconnect", "exit", "error") do the cleanup once
   * between them rather than once each -- three respawns for one death. */
  retired: boolean;
  /** Settles this worker's `ready` promise. Held on the worker so retireWorker
   * can settle it from outside spawnWorker's closure. */
  settleReady: (result: { ok: boolean; error?: string }) => void;
  /** When this worker was forked, so a death can be classified as "crashed on
   * startup" (needs backoff) or "ran for a while and then died" (respawn
   * immediately). See scheduleRespawn. */
  spawnedAt: number;
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
    // A worker whose IPC channel has already closed is not somewhere to put
    // work, and finding that out by sending is fatal: send() on a closed
    // channel does not throw where the caller can catch it, it schedules
    // `this.emit("error", ERR_IPC_CHANNEL_CLOSED)` on nextTick, and an
    // unhandled "error" on a ChildProcess is a process-wide throw. That is
    // exactly #163's shape -- a nextTick throw taking the whole API down --
    // and it was reachable here, confirmed by running the real pool against a
    // worker whose channel had gone: "Unhandled 'error' event ... at pump".
    //
    // The window is not theoretical either. Node delivers "disconnect" before
    // "exit" (confirmed by hand), and only "exit" used to remove a worker from
    // this array, so every crashed worker spent a real interval sitting here
    // advertising itself as idle with a dead channel. Any request arriving in
    // that interval killed the server.
    if (!worker.proc.connected) {
      retireWorker(worker, "worker IPC channel closed");
      continue;
    }
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

/**
 * How long a worker has to survive before its death counts as "it was
 * working and then something happened" rather than "it cannot start".
 */
const RESPAWN_HEALTHY_MS = 30_000;
/** First backoff step, doubling per consecutive startup death. */
const RESPAWN_MIN_DELAY_MS = 250;
const RESPAWN_MAX_DELAY_MS = 30_000;

let consecutiveStartupDeaths = 0;
/** Respawns waiting on a backoff timer. Counted so ensureStarted doesn't see
 * an empty `workers` mid-backoff and helpfully build a whole second pool.
 * Held as the live timers rather than a bare count so stopTtsPool can cancel
 * them: a count alone would stay non-zero after a teardown, and since the
 * stale timer then declines to spawn (its generation no longer matches), the
 * two guards between them would block ensureStarted from starting anything
 * for the rest of the backoff. Only tests stop and restart a pool today --
 * production only stops on the way out -- but a teardown that leaves the
 * next pool unable to start is exactly the kind of cross-test bleed that
 * surfaces later as an unrelated flake. */
const pendingRespawns = new Set<NodeJS.Timeout>();
/** Bumped by stopTtsPool, so a respawn already on a timer when the pool was
 * torn down doesn't fork a worker into the pool that replaced it. */
let poolGeneration = 0;

/**
 * Replaces a dead worker, with a delay when it died on startup.
 *
 * The delay is the fix for a hot restart loop. A worker that cannot start at
 * all -- a missing dist/tts-worker-process.js, a native binding that won't
 * load, an OOM at model load -- exits immediately, and the exit handler
 * re-forked it immediately, forever: measured at ~3 node processes a second
 * with an error line each, for the life of the process. Retrying harder
 * cannot fix any of those conditions; all the tight loop buys is a pegged
 * core and a log too noisy to read the original failure out of.
 *
 * A worker that ran normally and then died is still replaced instantly --
 * that is the case the respawn exists for, and making a real crash wait would
 * be a regression.
 */
function scheduleRespawn(diedAfterMs: number): void {
  if (diedAfterMs >= RESPAWN_HEALTHY_MS) consecutiveStartupDeaths = 0;
  else consecutiveStartupDeaths++;

  const delay =
    consecutiveStartupDeaths === 0
      ? 0
      : Math.min(RESPAWN_MAX_DELAY_MS, RESPAWN_MIN_DELAY_MS * 2 ** (consecutiveStartupDeaths - 1));

  if (delay === 0) {
    workers.push(spawnWorker());
    pump();
    return;
  }

  const generation = poolGeneration;
  const timer = setTimeout(() => {
    pendingRespawns.delete(timer);
    if (generation !== poolGeneration) return; // pool was stopped while we waited
    workers.push(spawnWorker());
    pump();
  }, delay);
  pendingRespawns.add(timer);
  // Never the reason the process stays alive -- a backoff timer must not hold
  // a deploy open the way an un-unref'd interval would.
  timer.unref();
}

/**
 * Everything that has to happen exactly once when a worker dies, whichever of
 * the three events reported it.
 *
 * There are three, and before this they were not all handled: "exit" was, but
 * "disconnect" (delivered first) was not, and "error" had no listener at all
 * -- which is itself a process-killer, since an EventEmitter with no "error"
 * listener rethrows. Funnelling all three through one idempotent function is
 * what stops one death producing three respawns.
 */
function retireWorker(worker: PoolWorker, reason: string): void {
  if (worker.stopped || worker.retired) return; // deliberate shutdown, or already handled
  worker.retired = true;
  console.error(`[tts-pool] ${reason}, respawning`);

  // A worker that dies before reporting in must still settle its readiness,
  // or a cold start staged behind it (ensureStarted) would wait forever and
  // the pool would be permanently stuck at one worker.
  worker.loaded = false;
  worker.settleReady({ ok: false, error: reason });

  // That request's caller still needs to actually be told it failed: without
  // this, a crash left its entry sitting in `inFlight` forever (nothing else
  // was ever going to resolve or reject it), which meant the client's fetch
  // just hung with no error and no timeout -- confirmed by hand this is
  // strictly worse than a slow chunk, since a slow chunk at least eventually
  // finishes.
  if (worker.currentRequestId !== null) {
    const task = inFlight.get(worker.currentRequestId);
    inFlight.delete(worker.currentRequestId);
    worker.currentRequestId = null;
    task?.reject(new Error("TTS worker process exited unexpectedly."));
  }

  workers = workers.filter((w) => w !== worker);
  // Usually already dead, in which case this is a no-op -- but a worker can
  // lose its channel and keep running, and one that nothing can talk to is a
  // process holding a ~90MB model resident for no reason. Dropping it from
  // `workers` without killing it would leak exactly that, permanently, since
  // stopTtsPool only ever kills what is still in the array.
  worker.proc.kill();
  scheduleRespawn(Date.now() - worker.spawnedAt);
}

function spawnWorker(): PoolWorker {
  // TTS_POOL_SIZE is passed down explicitly rather than relied on being set
  // in the environment: the pool's size is now derived from core count when
  // the variable is absent, and the worker divides cores by that same number
  // to size its ONNX thread pool. If it inherited an unset variable it would
  // fall back to a different default and oversubscribe again (#162).
  const env = { ...process.env, TTS_POOL_SIZE: String(POOL_SIZE) };
  const forkOptions: import("node:child_process").ForkOptions = {
    serialization: "advanced",
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    env,
  };
  const proc = isDev
    ? fork(require.resolve("tsx/cli"), [workerEntry], forkOptions)
    : fork(workerEntry, forkOptions);

  let settleReady: (result: { ok: boolean; error?: string }) => void = () => {};
  const worker: PoolWorker = {
    proc,
    busy: false,
    currentRequestId: null,
    loaded: false,
    stopped: false,
    retired: false,
    spawnedAt: Date.now(),
    settleReady: (result) => settleReady(result),
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
  // chunk failing without aborting the whole article. See retireWorker for
  // the cleanup all three of these share.
  proc.on("exit", (code) => retireWorker(worker, `worker exited unexpectedly (code ${code})`));

  // Delivered *before* "exit", and the reason pump() has to check
  // proc.connected: for the interval between the two, a dead worker was still
  // in `workers` looking idle.
  proc.on("disconnect", () => retireWorker(worker, "worker IPC channel closed"));

  // Not optional, and not defensive decoration. A ChildProcess is an
  // EventEmitter, and an EventEmitter with no "error" listener *rethrows* --
  // so a failed fork, a failed kill, or an IPC send that cannot be delivered
  // does not surface as a rejected promise here, it surfaces as an uncaught
  // exception that ends the API process. Same failure shape as #163's
  // tesseract.js nextTick throw, same fix: give it a listener so it comes
  // back into ordinary control flow.
  proc.on("error", (err) => retireWorker(worker, `worker process error: ${err.message}`));

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
  // pendingRespawns is part of the guard, not an extra: while a crashed
  // worker's replacement is waiting on scheduleRespawn's backoff, `workers`
  // can legitimately be empty, and without this a request arriving in that
  // gap would build an entire second pool alongside the one already coming.
  if (workers.length > 0 || starting || pendingRespawns.size > 0) return;
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
 * How many real (non-speculative) requests are waiting for a worker.
 *
 * Exported so /api/tts can shed load before enqueuing. The route's rate limit
 * is per IP over ten minutes, which bounds one caller and says nothing about
 * how many callers there are -- so the queue is the only place the aggregate
 * is visible, and unbounded queueing on a route where each item costs a
 * multi-second forward pass means every one of those callers holds a
 * connection open waiting for audio that arrives long after they stopped
 * caring.
 *
 * Deliberately excludes lowPriorityQueue: warming is already drained only by
 * capacity that would otherwise be idle, so counting it would shed real
 * requests on the strength of work that is by construction not competing
 * with them.
 */
export function ttsQueueDepth(): number {
  return queue.length;
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
  poolGeneration++;
  consecutiveStartupDeaths = 0;
  // Cancel rather than merely out-generation them, so the next pool is free to
  // start immediately instead of waiting out a backoff belonging to the pool
  // that just died.
  for (const timer of pendingRespawns) clearTimeout(timer);
  pendingRespawns.clear();
  for (const worker of workers) {
    worker.stopped = true;
    worker.proc.kill();
  }
  workers = [];

  // Everything anyone was waiting on has to be failed, not abandoned.
  //
  // These used to be left exactly as they were: `worker.stopped` makes the
  // kill's "exit" a no-op, so nothing ever settled an in-flight request, and
  // the queues kept tasks whose workers no longer existed. Confirmed by hand
  // against the real pool -- an in-flight generation was still "PENDING" long
  // after stopTtsPool() returned, with nothing left alive that could ever
  // change that.
  //
  // It matters most on the path this runs on for real. SIGTERM reaches this
  // module's handler as well as index.ts's, so the workers die while
  // closeWithTimeout is still draining -- and a request that can neither
  // finish nor fail is precisely what that drain cannot get past. The deploy
  // then burns the whole shutdown timeout and cuts the connection anyway,
  // which is the outcome the drain exists to avoid. A rejection lets the
  // route answer, the client retry, and the server close on time.
  const abandoned = [...inFlight.values(), ...queue.splice(0), ...lowPriorityQueue.splice(0)];
  inFlight.clear();
  for (const task of abandoned) {
    task.reject(new Error("TTS pool shut down before this request could be generated."));
  }
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
