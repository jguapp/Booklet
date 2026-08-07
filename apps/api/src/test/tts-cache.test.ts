import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the cache tier with **no REDIS_URL set** -- i.e. the
 * configuration every dev machine and every deployment that hasn't opted
 * into Redis actually runs. The whole point of the optional-dependency
 * contract (see DEPLOYMENT.md) is that this path behaves exactly as the
 * original single-tier cache did, so it's the one that most needs a test.
 */

const AUDIO = (n: number, byte = 1) => Buffer.alloc(n, byte);

async function freshCache(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("../services/tts-cache.js");
}

describe("tts-cache (no Redis configured)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.TTS_CACHE_MAX_MB;
  });

  it("round-trips a buffer through the in-memory tier", async () => {
    const { getCachedSpeech, setCachedSpeech } = await freshCache({ REDIS_URL: undefined });
    expect(await getCachedSpeech("hello", "af_heart", 1)).toEqual({ tier: "miss", buffer: null });
    setCachedSpeech("hello", "af_heart", 1, AUDIO(128));
    expect(await getCachedSpeech("hello", "af_heart", 1)).toEqual({ tier: "l1", buffer: AUDIO(128) });
  });

  // The tier, not just hit/miss: it is reported as a span attribute and as
  // the `cache` Server-Timing entry, and "served instantly from this
  // process" and "served after a Redis round trip" are different answers to
  // "why was that chunk fast?". With no Redis configured, l2 is unreachable
  // by construction and every miss must say so rather than claiming a tier.
  it("reports which tier answered, not merely whether one did", async () => {
    const { getCachedSpeech, setCachedSpeech } = await freshCache({ REDIS_URL: undefined });
    expect((await getCachedSpeech("x", "af_heart", 1)).tier).toBe("miss");
    setCachedSpeech("x", "af_heart", 1, AUDIO(32));
    expect((await getCachedSpeech("x", "af_heart", 1)).tier).toBe("l1");
  });

  it("keys on text, voice and speed independently", async () => {
    const { getCachedSpeech, setCachedSpeech } = await freshCache({ REDIS_URL: undefined });
    setCachedSpeech("hello", "af_heart", 1, AUDIO(16, 1));
    expect((await getCachedSpeech("hello", "af_heart", 1.5)).buffer).toBeNull();
    expect((await getCachedSpeech("hello", "bm_george", 1)).buffer).toBeNull();
    expect((await getCachedSpeech("goodbye", "af_heart", 1)).buffer).toBeNull();
  });

  it("does not let voice/speed/text run together into a colliding key", async () => {
    // The separator matters: with a naive join, ("b", 1, "x") and
    // ("b 1", ...) style shifts could hash identically and serve one
    // request another's audio.
    const { speechCacheKey } = await freshCache({ REDIS_URL: undefined });
    expect(speechCacheKey("x", "ab", 1)).not.toBe(speechCacheKey("x", "a", 1));
    expect(speechCacheKey("1 x", "a", 1)).not.toBe(speechCacheKey("x", "a", 1));
  });

  it("evicts least-recently-used entries once over the byte budget", async () => {
    // 1MB budget, four 400KB entries -- only ~2 fit at a time.
    const { getCachedSpeech, setCachedSpeech } = await freshCache({
      REDIS_URL: undefined,
      TTS_CACHE_MAX_MB: "1",
    });
    const big = 400 * 1024;
    setCachedSpeech("a", "v", 1, AUDIO(big, 1));
    setCachedSpeech("b", "v", 1, AUDIO(big, 2));

    // Touch "a" so "b" becomes the least-recently-used of the two.
    expect((await getCachedSpeech("a", "v", 1)).buffer).not.toBeNull();

    setCachedSpeech("c", "v", 1, AUDIO(big, 3));

    expect((await getCachedSpeech("c", "v", 1)).buffer).not.toBeNull();
    expect((await getCachedSpeech("a", "v", 1)).buffer).not.toBeNull();
    expect((await getCachedSpeech("b", "v", 1)).buffer).toBeNull();
  });

  it("overwrites rather than double-counting a repeated key", async () => {
    const { getCachedSpeech, setCachedSpeech } = await freshCache({
      REDIS_URL: undefined,
      TTS_CACHE_MAX_MB: "1",
    });
    const big = 400 * 1024;
    for (let i = 0; i < 5; i++) setCachedSpeech("same", "v", 1, AUDIO(big, 9));
    // If currentBytes accumulated on every write instead of replacing, the
    // eviction loop would have thrown this entry out.
    expect((await getCachedSpeech("same", "v", 1)).buffer).not.toBeNull();
  });

  it("setCachedSpeech stays synchronous so it never delays the response", async () => {
    const { setCachedSpeech } = await freshCache({ REDIS_URL: undefined });
    expect(setCachedSpeech("hello", "af_heart", 1, AUDIO(8))).toBeUndefined();
  });
});
