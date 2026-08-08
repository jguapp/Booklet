/**
 * Content-addressed cache for generated speech, keyed by exactly what
 * determines the audio (voice + speed + the text itself), not by article --
 * replaying the same article, re-reading a paragraph, or two different
 * articles that happen to share a sentence all hit the same cache entry.
 * Confirmed by hand this is a real, frequent complaint, not a rare edge
 * case: stopping playback and starting the same article over re-requests
 * every chunk from scratch, paying the full multi-second generation cost
 * again for audio that was already produced once.
 *
 * Lives here (the main server process, alongside the pool's queue/dispatch
 * logic in tts-pool.ts), not inside tts-service.ts -- that file runs
 * *inside* each forked worker process (see tts-worker-process.ts), a
 * separate OS process with its own memory. A cache there would mean up to
 * TTS_POOL_SIZE independent, mostly-empty caches instead of one shared one,
 * and would still pay a full worker dispatch round-trip on every hit. This
 * cache is checked before a request ever reaches the queue, so a hit
 * returns immediately with zero pool contention.
 *
 * Two tiers. L1 is the in-process Map below, bounded by MAX_CACHE_BYTES with
 * simple LRU eviction (a Map's insertion order, re-inserting on every access,
 * is exactly LRU order) rather than growing unbounded for the life of the
 * process. L2 is an optional Redis (see redis-client.ts), checked only on an
 * L1 miss.
 *
 * L1 alone used to be the whole cache, and its two limits both mattered more
 * than they look: it was lost on every restart *and* every deploy, so the
 * first person to read anything after a release paid full generation cost
 * again for audio the previous instance had already produced; and it was
 * per-process, so nothing was shared between instances or between a user's
 * devices. Since generation is measured in seconds and a cache hit in
 * milliseconds, that restart cliff was the single largest remaining source
 * of slow time-to-first-audio once warming was in place.
 *
 * L1 is kept in front rather than replaced because a Redis round trip, while
 * far cheaper than generating, is not free -- and within one listening
 * session the same process is asked for the same chunks repeatedly.
 *
 * Redis is entirely optional: with no REDIS_URL set, every L2 call is a no-op
 * and this behaves exactly as the single-tier version did.
 */
import { createHash } from "node:crypto";
import { redisGetBuffer, redisSetBuffer, redisTouch } from "./redis-client.js";

/**
 * Both numbers below used to be `Number(process.env.X || default)`, which
 * silently produces NaN for anything that isn't a bare number -- and NaN is
 * the worst possible value for each of them.
 *
 * `currentBytes > NaN` is false, so a NaN budget doesn't fall back to the
 * default, it disables the eviction loop entirely: the "bounded" L1 map grows
 * for the life of the process until the container is OOM-killed. Confirmed by
 * running it -- `TTS_CACHE_MAX_MB="200MB"` (a units typo, and the most likely
 * way anyone gets this wrong) retained 800 MB against a 200 MB cap, and would
 * have retained any amount. The Redis TTL is milder but the same shape: a NaN
 * lands in `setex`, every write errors, and the circuit breaker turns L2 off.
 *
 * So this validates and says so. A bad value falling back quietly would leave
 * the operator believing a cap that isn't in force, which is the specific
 * thing that makes the memory case dangerous rather than merely wrong.
 */
function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[tts-cache] ${name}="${raw}" is not a positive number -- using the default of ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const MAX_CACHE_BYTES = positiveNumberFromEnv("TTS_CACHE_MAX_MB", 200) * 1024 * 1024;

/** How long generated audio survives in Redis without being read. Long,
 * deliberately: a saved article's text doesn't change, so a chunk generated
 * a month ago is still exactly correct today, and re-reading an article is
 * the single most valuable cache hit there is. */
const REDIS_TTL_SECONDS = positiveNumberFromEnv("TTS_REDIS_TTL_DAYS", 30) * 86400;

/** A 1000-char chunk (the route's ceiling) is roughly 350 KB at 16-bit, so
 * this only ever catches pathology -- but refusing outright beats writing a
 * multi-megabyte value into Redis on a bad input. */
const MAX_REDIS_VALUE_BYTES = 4 * 1024 * 1024;

/**
 * The audio format is baked into the key prefix, not merely a version
 * number. Unlike the in-memory tier, Redis survives a deploy -- so during a
 * rolling release, old and new instances share it. When the encoding changed
 * (32-bit float to 16-bit PCM, see wav-pcm16.ts) a shared prefix would have
 * meant new instances decoding bytes an old one wrote in a format they no
 * longer expect. Change this string whenever the bytes change.
 */
const KEY_PREFIX = "tts:pcm16:v1:";

const cache = new Map<string, Buffer>();
let currentBytes = 0;

/** Exported so tts-pool.ts's in-flight de-duplication keys on exactly the
 * same identity this cache does -- two different notions of "the same
 * request" drifting apart would mean either redundant generation or, worse,
 * a request served audio for different text. */
const KEY_SEPARATOR = "\u0000";

export function speechCacheKey(text: string, voice: string, speed: number): string {
  // The separator is a NUL escape rather than a raw NUL byte. Both are the
  // same character, so the digest is byte-for-byte unchanged and no cached
  // audio is invalidated -- but a raw one makes this file "binary" to grep
  // and ripgrep, which silently hides every symbol in it from a repo-wide
  // search. A dead-code scan missed this module entirely for that reason.
  return KEY_PREFIX + createHash("sha256").update([voice, speed, text].join(KEY_SEPARATOR)).digest("hex");
}

/** Promotes an L2 hit into L1 (and enforces the byte budget) without
 * writing it back to Redis, which already has it. */
function putInMemory(key: string, buffer: Buffer): void {
  const existing = cache.get(key);
  if (existing) currentBytes -= existing.length;
  cache.delete(key);
  cache.set(key, buffer);
  currentBytes += buffer.length;

  while (currentBytes > MAX_CACHE_BYTES && cache.size > 0) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey);
    if (oldest) currentBytes -= oldest.length;
    cache.delete(oldestKey);
  }
}

/** Which tier answered. Reported as a span attribute (see telemetry.ts) and
 * as the `cache` Server-Timing entry on /api/tts: "was that slow?" and "did
 * it come from L1, L2, or nowhere?" are the same question in practice, and
 * a boolean hit/miss can't distinguish an in-process hit from one that cost
 * a Redis round trip. */
export type CacheTier = "l1" | "l2" | "miss";

export type CacheLookup =
  | { tier: "l1" | "l2"; buffer: Buffer }
  | { tier: "miss"; buffer: null };

/**
 * Async now, because of the Redis tier. L1 is still checked synchronously
 * first, so a chunk that's already local resolves without any network
 * involvement at all -- which is the common case for the whole of a single
 * listening session.
 */
export async function getCachedSpeech(text: string, voice: string, speed: number): Promise<CacheLookup> {
  const key = speechCacheKey(text, voice, speed);

  const local = cache.get(key);
  if (local) {
    // Touch: re-insert so this becomes the most-recently-used entry --
    // Map iteration/deletion order is insertion order, so this is what makes
    // the eviction loop above a real LRU instead of just FIFO.
    cache.delete(key);
    cache.set(key, local);
    return { tier: "l1", buffer: local };
  }

  // L2. Returns null on a miss *and* on every failure mode (unreachable,
  // slow, circuit open, not configured) -- all of which mean the same thing
  // to this caller: generate it instead.
  const remote = await redisGetBuffer(key);
  if (!remote) return { tier: "miss", buffer: null };

  putInMemory(key, remote);
  redisTouch(key, REDIS_TTL_SECONDS);
  return { tier: "l2", buffer: remote };
}

/**
 * Deliberately still synchronous and still void-returning. The caller
 * already holds the audio and is about to send it, so waiting on a cache
 * write would add latency to the exact path this cache exists to shorten:
 * L1 is written synchronously, and the Redis write is fired and forgotten
 * (its failures fold into redis-client's circuit breaker).
 */
export function setCachedSpeech(text: string, voice: string, speed: number, buffer: Buffer): void {
  const key = speechCacheKey(text, voice, speed);
  putInMemory(key, buffer);
  if (buffer.length <= MAX_REDIS_VALUE_BYTES) redisSetBuffer(key, buffer, REDIS_TTL_SECONDS);
}
