// One-off benchmark for the TTS pipeline's real time-to-first-audio (TTFA)
// cost -- see apps/web/src/lib/reader/kokoro-tts.ts's own comment on why
// the *first* chunk's generation time IS "time to first audio" in the
// literal sense: nothing is playing yet, so nothing hides the wait.
//
// Not part of the regular test suite (`pnpm test`) -- this is a real,
// multi-minute model download plus several genuine Kokoro generations, not
// a correctness check. Run manually:
//   pnpm --filter @booklet/api exec tsx scripts/bench-tts-ttfa.ts
// or via CI's bench-tts-ttfa job, which has the real network access this
// sandbox doesn't (Kokoro's weights are fetched from Hugging Face).
import { generateSpeechPooled } from "../src/services/tts-pool.js";

const VOICE = "af_heart";
const SPEED = 1;

// ~75 chars each, matching kokoro-tts.ts's FIRST_CHUNK_MAX_CHARS (80) --
// the actual size of the chunk whose generation time is what a user
// waiting for "read aloud" to start actually feels.
const FIRST_CHUNK_TEXT = "The quick brown fox jumps over the lazy dog near the old wooden bridge.";
const SECOND_CHUNK_TEXT = "A distant train whistle echoed through the quiet valley just after dawn.";
const PREWARM_TEXT = "Rain tapped steadily against the window while the fire slowly burned low.";
const CONCURRENT_TEXTS = [
  "Morning fog settled over the harbor as the first boats left the dock.",
  "He counted the streetlights fading one by one as the sky grew lighter.",
  "The old clock tower struck seven, and the market square slowly filled.",
];

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  console.log(`${label}: ${(performance.now() - start).toFixed(0)}ms`);
  return result;
}

async function main(): Promise<void> {
  console.log(`--- TTS TTFA benchmark (voice=${VOICE}, speed=${SPEED}) ---\n`);

  // 1. Real cold start: the pool hasn't been touched yet, so this pays for
  // spawning the 3 worker processes and loading a Kokoro model in each --
  // mirrors a request landing before warmTtsPool() (see index.ts) has
  // finished, or a server that skipped startup warming entirely.
  const cold = await timed("1. Cold (pool not yet started)", () =>
    generateSpeechPooled(FIRST_CHUNK_TEXT, VOICE, SPEED),
  );
  if (cold.length === 0) throw new Error("cold generation returned an empty buffer");

  // 2. Warm pool (all 3 workers now loaded from #1), distinct uncached
  // text -- the realistic "server already warm, no prewarm head start"
  // case: a first chunk of a *different* article than #1 generated.
  await timed("2. Warm pool, uncached chunk", () => generateSpeechPooled(SECOND_CHUNK_TEXT, VOICE, SPEED));

  // 3. Cache hit -- rereading the same text (see tts-cache.ts).
  await timed("3. Cache hit (repeat of #2's text)", () => generateSpeechPooled(SECOND_CHUNK_TEXT, VOICE, SPEED));

  // 4. 3 concurrent, distinct, previously-unseen chunks -- tts-pool.ts's
  // own comment claims ~1x a single generation's wall-clock time for all
  // three (real parallelism), not 3x (serialized).
  await timed("4. 3 concurrent uncached chunks (pool of 3)", () =>
    Promise.all(CONCURRENT_TEXTS.map((text) => generateSpeechPooled(text, VOICE, SPEED))),
  );

  // 5. Prewarm effectiveness -- simulate reader-view.tsx's
  // prewarmFirstChunk firing while the user is still looking at the
  // article, then measure only the *residual* wait once "play" is pressed
  // some time later. 800ms approximates the gap between an article
  // finishing its load and a user actually reaching for the play button --
  // a realistic head start, not an instant one.
  const prewarmStart = performance.now();
  const prewarmPromise = generateSpeechPooled(PREWARM_TEXT, VOICE, SPEED);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const playPressedAt = performance.now();
  await prewarmPromise;
  console.log(
    `5. Pre-warmed chunk: ${(performance.now() - prewarmStart).toFixed(0)}ms real generation time, ` +
      `only ${(performance.now() - playPressedAt).toFixed(0)}ms still felt as TTFA after an 800ms head start`,
  );

  console.log("\n--- done ---");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
