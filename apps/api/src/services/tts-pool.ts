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
const queue: QueuedTask[] = [];
const inFlight = new Map<number, { resolve: (buffer: Buffer) => void; reject: (err: Error) => void }>();

function pump(): void {
  for (const worker of workers) {
    if (worker.busy) continue;
    const task = queue.shift();
    if (!task) return;
    worker.busy = true;
    const id = nextRequestId++;
    inFlight.set(id, task);
    worker.proc.send({ id, text: task.text, voice: task.voice, speed: task.speed });
  }
}

function spawnWorker(): PoolWorker {
  const proc = isDev
    ? fork(require.resolve("tsx/cli"), [workerEntry], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] })
    : fork(workerEntry, { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });

  const worker: PoolWorker = { proc, busy: false };

  proc.on("message", (msg: WorkerMessage) => {
    const task = inFlight.get(msg.id);
    if (!task) return;
    inFlight.delete(msg.id);
    if (msg.error) task.reject(new Error(msg.error));
    else if (msg.buffer) task.resolve(Buffer.from(msg.buffer));
    worker.busy = false;
    pump();
  });

  // A worker dying mid-generation (native crash, OOM) shouldn't take the
  // rest of the pool down with it -- replace it and let whatever request
  // it was holding fail; the client's own chunk loop already tolerates one
  // chunk failing without aborting the whole article.
  proc.on("exit", (code) => {
    console.error(`[tts-pool] worker exited unexpectedly (code ${code}), respawning`);
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

export function generateSpeechPooled(text: string, voice: string, speed: number): Promise<Buffer> {
  ensureStarted();
  return new Promise((resolve, reject) => {
    queue.push({ text, voice, speed, resolve, reject });
    pump();
  });
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
