/**
 * Stand-in for tts-worker-process.ts, used by tts-pool-coldstart.test.ts via
 * the pool's TTS_WORKER_ENTRY override.
 *
 * It honours the one part of the real worker's startup contract the pool's
 * staging depends on -- "send { type: 'ready' } once the model load settles,
 * either way" -- without loading a real 90MB Kokoro model, which would make
 * the test a network download rather than a test.
 *
 * FAKE_TTS_LOAD_MS is the simulated load time; a negative value means "report
 * a failed load", which the real worker also does rather than throwing, so
 * the pool hears something and doesn't wait forever.
 *
 * Deliberately never exits on its own: the pool treats an unexpected worker
 * exit as a crash and respawns, so a self-terminating stand-in would loop.
 * The test calls stopTtsPool() to clean up.
 */
const loadMs = Number(process.env.FAKE_TTS_LOAD_MS ?? 0);

setTimeout(
  () => {
    process.send?.(
      loadMs < 0 ? { type: "ready", ok: false, error: "simulated model load failure" } : { type: "ready", ok: true },
    );
  },
  Math.max(0, loadMs),
);

// Keeps the process alive so the pool sees a stable worker.
setInterval(() => {}, 1 << 30);
