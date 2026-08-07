/**
 * Optional Redis connection, used as the shared/persistent tier behind the
 * in-memory TTS audio cache (see tts-cache.ts).
 *
 * Entirely optional, in the same sense as RESEND_API_KEY and SENTRY_DSN
 * elsewhere in this app: with no REDIS_URL set, every function here is a
 * no-op and behavior is byte-identical to having no Redis at all. That's the
 * contract DEPLOYMENT.md documents for every optional dependency, and it's
 * what keeps `pnpm dev` working with nothing extra installed.
 *
 * The thing this module exists to get right is that **a cache is only worth
 * having if it is reliably faster than the thing it caches**. A Redis that is
 * slow, or down, or reachable-but-unresponsive must never make a request
 * slower than simply generating the audio would have been. Two mechanisms
 * enforce that, and both are load-bearing rather than defensive decoration:
 *
 *  - Every read races a hard timeout. Past it, the read is abandoned and
 *    treated as a miss. Generation is measured in seconds, so a lookup that
 *    hasn't answered in a fraction of a second has already lost its reason to
 *    exist.
 *  - A circuit breaker. Without one, a Redis that is down makes *every*
 *    subsequent request pay the connect timeout before falling through --
 *    converting the cache into a pure latency tax at exactly the moment it's
 *    providing no value. After a failure, Redis is skipped outright for a
 *    cooling-off window.
 *
 * Errors are logged once per open-circuit window rather than per request:
 * ioredis retries connections continuously in the background, so per-request
 * logging turns one downed dependency into an unbounded log flood.
 */
import { Redis } from "ioredis";

/** Past this, a lookup has already cost more than it can possibly save. */
const READ_TIMEOUT_MS = 150;
/** How long to stop talking to Redis entirely after a failure. */
const CIRCUIT_OPEN_MS = 30_000;

let client: Redis | null = null;
let initialized = false;
let circuitOpenUntil = 0;

function getClient(): Redis | null {
  if (initialized) return client;
  initialized = true;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  client = new Redis(url, {
    // One retry, not the default 20 -- a command that needs retrying that
    // hard has already blown the latency budget this cache exists to protect.
    maxRetriesPerRequest: 1,
    // Without this, commands issued while disconnected queue up silently and
    // resolve much later, which reads as a mysterious stall rather than the
    // clean miss the caller can actually handle.
    enableOfflineQueue: false,
    connectTimeout: 1000,
    lazyConnect: true,
  });

  // ioredis emits "error" on every reconnection attempt. Without a listener
  // these become unhandled 'error' events and take the process down; with a
  // naive listener they flood the logs. Fold them into the circuit breaker.
  client.on("error", (err) => tripCircuit(err));

  return client;
}

function tripCircuit(err: unknown): void {
  const wasOpen = Date.now() < circuitOpenUntil;
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  if (!wasOpen) {
    console.error(
      `[redis] unavailable, skipping the TTS cache tier for ${CIRCUIT_OPEN_MS / 1000}s:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/** True when a REDIS_URL is configured at all -- for logging and for the
 * benchmark to report which tiers it actually exercised. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

async function withTimeout<T>(op: Promise<T>, label: string): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${READ_TIMEOUT_MS}ms`)), READ_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    tripCircuit(err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns null on a miss, and on *every* failure mode -- unreachable, slow,
 * circuit open, or not configured. Callers treat all of those identically:
 * generate the audio instead. */
export async function redisGetBuffer(key: string): Promise<Buffer | null> {
  const redis = getClient();
  if (!redis || circuitIsOpen()) return null;
  return withTimeout(redis.getBuffer(key), "redis get");
}

/** Fire-and-forget by design: the caller already has the audio in hand, so a
 * slow write must not delay returning it. Failures are swallowed into the
 * circuit breaker. */
export function redisSetBuffer(key: string, value: Buffer, ttlSeconds: number): void {
  const redis = getClient();
  if (!redis || circuitIsOpen()) return;
  redis.setex(key, ttlSeconds, value).catch((err: unknown) => tripCircuit(err));
}

/** Refreshes a hit's TTL so frequently-read audio outlives audio nobody has
 * touched in weeks. Un-awaited -- it must add nothing to the read path. */
export function redisTouch(key: string, ttlSeconds: number): void {
  const redis = getClient();
  if (!redis || circuitIsOpen()) return;
  redis.expire(key, ttlSeconds).catch((err: unknown) => tripCircuit(err));
}

/** Lets the process exit cleanly (the bench script and tests both need this
 * -- an open ioredis connection keeps the event loop alive). */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  initialized = false;
  try {
    await c.quit();
  } catch {
    c.disconnect();
  }
}
