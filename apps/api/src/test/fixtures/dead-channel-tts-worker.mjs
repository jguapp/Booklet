/**
 * A stand-in TTS worker that reports ready and then drops its IPC channel
 * while staying alive. Used by tts-pool-failure.test.ts.
 *
 * It models the window the pool never used to close. A real worker that dies
 * produces "disconnect" and then "exit", in that order (confirmed by hand),
 * and only "exit" removed it from the pool -- so for the interval between the
 * two, a worker with a dead channel sat there advertising itself as idle.
 * Staying alive here just makes that interval long enough to drive from a
 * test instead of having to win a race against it; the state the pool sees is
 * identical either way.
 *
 * Plain .mjs, not .ts like fake-tts-worker.ts, because these cases exercise
 * the production fork path (node running the worker directly) rather than
 * dev's tsx wrapper -- the wrapper is a second process in between, and it is
 * the pool's own channel to its own child that this is about.
 */
process.send?.({ type: "ready", ok: true });

setTimeout(() => process.disconnect?.(), 100);

// Keeps the process alive so the pool sees a live worker with a dead channel.
setInterval(() => {}, 1 << 30);
