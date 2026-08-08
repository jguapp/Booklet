/**
 * A stand-in TTS worker that cannot start, used by tts-pool-failure.test.ts.
 *
 * The shape of every real "the worker will never run here" failure -- a
 * missing dist/tts-worker-process.js, a native binding that will not load, an
 * OOM at model load: the process exits immediately, every time, and no amount
 * of respawning changes that.
 */
process.exit(1);
