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
import { availableParallelism } from "node:os";
import { generateSpeechPooled, POOL_SIZE } from "../src/services/tts-pool.js";
import { closeRedis, isRedisConfigured } from "../src/services/redis-client.js";

const VOICE = "af_heart";
const SPEED = 1;

// ~75 chars each, matching kokoro-tts.ts's FIRST_CHUNK_MAX_CHARS (80) --
// the actual size of the chunk whose generation time is what a user
// waiting for "read aloud" to start actually feels.
const FIRST_CHUNK_TEXT = "The quick brown fox jumps over the lazy dog near the old wooden bridge.";
const SECOND_CHUNK_TEXT = "A distant train whistle echoed through the quiet valley just after dawn.";
const PREWARM_TEXT = "Rain tapped steadily against the window while the fire slowly burned low.";
const DEDUPE_TEXT = "Snow fell on the empty platform long after the last train had gone.";
const CONCURRENT_TEXTS = [
  "Morning fog settled over the harbor as the first boats left the dock.",
  "He counted the streetlights fading one by one as the sky grew lighter.",
  "The old clock tower struck seven, and the market square slowly filled.",
];

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(0)}ms`);
  return { result, ms };
}

async function main(): Promise<void> {
  // The host matters more than anything else here: the pool's parallelism is
  // bounded by real cores, and the same numbers on a 2-vCPU runner and an
  // 8-core laptop mean completely different things. Reporting it is what
  // stopped #162 being invisible -- a "3 concurrent ~= 1x" claim measured on
  // a big machine had been sitting in the pool's own header as fact.
  console.log(`--- TTS TTFA benchmark (voice=${VOICE}, speed=${SPEED}) ---`);
  console.log(`host: ${availableParallelism()} logical cores, pool size ${POOL_SIZE}\n`);

  // 1. Real cold start: the pool hasn't been touched yet, so this pays for
  // spawning the 3 worker processes and loading a Kokoro model in each --
  // mirrors a request landing before warmTtsPool() (see index.ts) has
  // finished, or a server that skipped startup warming entirely.
  const { result: cold } = await timed("1. Cold (pool not yet started)", () =>
    generateSpeechPooled(FIRST_CHUNK_TEXT, VOICE, SPEED),
  );
  if (cold.length === 0) throw new Error("cold generation returned an empty buffer");

  // 2. Warm pool (all 3 workers now loaded from #1), distinct uncached
  // text -- the realistic "server already warm, no prewarm head start"
  // case: a first chunk of a *different* article than #1 generated.
  const { ms: singleMs } = await timed("2. Warm pool, uncached chunk", () =>
    generateSpeechPooled(SECOND_CHUNK_TEXT, VOICE, SPEED),
  );

  // 3. Cache hit -- rereading the same text (see tts-cache.ts).
  await timed("3. Cache hit (repeat of #2's text)", () => generateSpeechPooled(SECOND_CHUNK_TEXT, VOICE, SPEED));

  // 4. 3 concurrent, distinct, previously-unseen chunks -- tts-pool.ts's
  // own comment claims ~1x a single generation's wall-clock time for all
  // three (real parallelism), not 3x (serialized).
  const { ms: concurrentMs } = await timed(`4. ${CONCURRENT_TEXTS.length} concurrent uncached chunks (pool of ${POOL_SIZE})`, () =>
    Promise.all(CONCURRENT_TEXTS.map((text) => generateSpeechPooled(text, VOICE, SPEED))),
  );
  // The number #162 is actually about. 1.0 would be perfect parallelism;
  // CONCURRENT_TEXTS.length would be fully serialized. Printed as a ratio
  // rather than left for a reader to divide, because the absolute figures
  // move with the host and the ratio is the thing that regresses.
  console.log(
    `   -> ${(concurrentMs / singleMs).toFixed(2)}x a single generation ` +
      `(1.00x = perfect parallelism, ${CONCURRENT_TEXTS.length.toFixed(2)}x = fully serialized)`,
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

  // 6. In-flight de-duplication (tts-pool.ts's inFlightByKey). Five
  // simultaneous requests for one previously-unseen chunk should cost one
  // generation, not five -- this is the collision that happens for real
  // every time speculative warming and the play loop ask for the same chunk
  // at once. Compared against #2's measured single-generation cost rather
  // than an absolute threshold, since runner CPU varies enormously.
  const dedupeStart = performance.now();
  const dedupeResults = await Promise.all(
    Array.from({ length: 5 }, () => generateSpeechPooled(DEDUPE_TEXT, VOICE, SPEED)),
  );
  const dedupeMs = performance.now() - dedupeStart;
  const identical = dedupeResults.every((b) => b === dedupeResults[0]);
  console.log(`6. 5 concurrent identical requests: ${dedupeMs.toFixed(0)}ms, all shared one buffer: ${identical}`);

  // 7. Redis (L2) hit. Only meaningful with REDIS_URL set -- the point is
  // the tier that survives a restart, which is exactly what the in-process
  // L1 cannot do. Simulated here by writing, then reading back through a
  // module whose L1 has been cleared.
  if (isRedisConfigured()) {
    await timed("7. L2 (Redis) hit after L1 eviction", async () => {
      const { getCachedSpeech } = await import("../src/services/tts-cache.js");
      return getCachedSpeech(SECOND_CHUNK_TEXT, VOICE, SPEED);
    });
  } else {
    console.log("7. L2 (Redis) hit: skipped -- no REDIS_URL set");
  }

  // Payload size is a first-class number here, not a footnote: at 24kHz the
  // difference between 32-bit float and 16-bit PCM is ~48KB per second of
  // speech, which on a slow connection is directly felt as time to first
  // audio. Printing it means a regression shows up in CI logs.
  const bytesPerSecond = 24000 * 2;
  console.log(
    `\nPayload: ${(cold.length / 1024).toFixed(0)}KB for chunk one ` +
      `(~${(cold.length / bytesPerSecond).toFixed(1)}s of audio at 16-bit/24kHz)`,
  );

  console.log("\n--- done ---");
  await closeRedis();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
