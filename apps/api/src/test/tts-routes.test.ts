import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Stubbed so the success-path cases below never load the ~90MB Kokoro model.
// The header assertions are about how the route reports timings, not about
// the audio, so real generation would only make them slow and flaky.
const generateSpeechWithTimings = vi.fn();
/** Drives the route's load-shedding check; 0 means "pool is idle". */
let queueDepth = 0;
/** Two workers, so the cap under test is a multiple rather than the floor. */
let poolWorkers = 2;
vi.mock("../services/tts-pool.js", () => ({
  generateSpeechWithTimings: (...args: unknown[]) => generateSpeechWithTimings(...args),
  generateSpeechPooled: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  ttsQueueDepth: () => queueDepth,
  ttsPoolStatus: () => ({ started: poolWorkers > 0, workers: poolWorkers, loaded: poolWorkers }),
}));

const { buildApp } = await import("../app.js");

/**
 * Validation-only coverage for the two TTS routes. Every case here is
 * rejected *before* generation is reached, so none of them load the ~90MB
 * Kokoro model -- which is what makes them fast enough to actually run in
 * CI, unlike anything that generates real audio.
 *
 * The warm route especially needs this: it's public, unauthenticated, and
 * accepts an array, so its input bounds are the only thing standing between
 * a stranger and an arbitrary amount of queued server compute.
 */
describe("TTS routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });


  describe("POST /api/tts", () => {
    it("rejects a missing or blank text", async () => {
      expect((await app.inject({ method: "POST", url: "/api/tts", payload: { voice: "af_heart" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/tts", payload: { text: "   ", voice: "af_heart" } })).statusCode).toBe(400);
    });

    it("rejects text over the per-request ceiling", async () => {
      const res = await app.inject({ method: "POST", url: "/api/tts", payload: { text: "a".repeat(1001), voice: "af_heart" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("text_too_long");
    });

    /**
     * The rate limit above this bounds one IP over ten minutes and says
     * nothing about how many IPs there are, and the route is
     * unauthenticated -- so without a depth check, N distinct callers queue
     * an unbounded backlog of multi-second forward passes, each holding a
     * connection open for audio that arrives long after they gave up.
     */
    describe("load shedding", () => {
      it("serves normally while the queue is shallow", async () => {
        queueDepth = 0;
        generateSpeechWithTimings.mockResolvedValueOnce({
          buffer: Buffer.alloc(8),
          cacheTier: "miss",
          queueMs: 1,
          generateMs: 2,
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/tts",
          payload: { text: "hello", voice: "af_heart" },
        });
        expect(res.statusCode).toBe(200);
      });

      it("sheds with 503 and a Retry-After once the queue is at the cap", async () => {
        // 2 workers x 8 per worker = 16.
        queueDepth = 16;
        const res = await app.inject({
          method: "POST",
          url: "/api/tts",
          payload: { text: "hello", voice: "af_heart" },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().error).toBe("overloaded");
        // Without this the client is left to guess, and the obvious guess --
        // retry straight away -- is what turns a busy pool into a stuck one.
        expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      });

      it("sheds before generation rather than after", async () => {
        queueDepth = 16;
        generateSpeechWithTimings.mockClear();
        await app.inject({ method: "POST", url: "/api/tts", payload: { text: "hello", voice: "af_heart" } });
        // The whole point is not spending the forward pass. A 503 returned
        // after generating would cost exactly as much as serving it.
        expect(generateSpeechWithTimings).not.toHaveBeenCalled();
      });

      it("still rejects bad input while shedding", async () => {
        // Validation comes first, so an overloaded pool doesn't start
        // answering 503 to requests that were never going to be generated.
        queueDepth = 16;
        const res = await app.inject({
          method: "POST",
          url: "/api/tts",
          payload: { text: "hello", voice: "not_a_real_voice" },
        });
        expect(res.statusCode).toBe(400);
      });

      it("does not shed before the pool has spawned its first worker", async () => {
        // workers is 0 until the first request arrives, and a cap computed
        // straight from it would be 0 -- shedding the very request that
        // starts the pool, permanently.
        poolWorkers = 0;
        queueDepth = 0;
        generateSpeechWithTimings.mockResolvedValueOnce({
          buffer: Buffer.alloc(8),
          cacheTier: "miss",
          queueMs: 1,
          generateMs: 2,
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/tts",
          payload: { text: "hello", voice: "af_heart" },
        });
        poolWorkers = 2;
        expect(res.statusCode).toBe(200);
      });

      afterAll(() => {
        queueDepth = 0;
        poolWorkers = 2;
      });
    });

    it("rejects an unknown voice", async () => {
      const res = await app.inject({ method: "POST", url: "/api/tts", payload: { text: "hello", voice: "not_a_real_voice" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_voice");
    });

    it("rejects an out-of-range speed", async () => {
      for (const speed of [0.1, 3, "1"]) {
        const res = await app.inject({ method: "POST", url: "/api/tts", payload: { text: "hello", voice: "af_heart", speed } });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("invalid_speed");
      }
    });

    // Server-Timing is how a slow chunk gets attributed in the field --
    // queueing, generation, or neither -- from the browser, with no
    // server-side log access. Worth asserting because it is silent when
    // wrong: a malformed value, or a missing Timing-Allow-Origin, both
    // surface as an empty serverTiming array rather than any kind of error.
    it("reports where the time went via Server-Timing", async () => {
      generateSpeechWithTimings.mockResolvedValueOnce({
        buffer: Buffer.from("RIFF"),
        cacheTier: "miss",
        queueMs: 12,
        generateMs: 3400,
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/tts",
        payload: { text: "hello", voice: "af_heart" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["server-timing"]).toBe('cache;desc="miss", queue;dur=12, gen;dur=3400');
    });

    it("reports a cache hit as zero queue and generation time", async () => {
      generateSpeechWithTimings.mockResolvedValueOnce({
        buffer: Buffer.from("RIFF"),
        cacheTier: "l1",
        queueMs: 0,
        generateMs: 0,
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/tts",
        payload: { text: "hello", voice: "af_heart" },
      });
      expect(res.headers["server-timing"]).toBe('cache;desc="l1", queue;dur=0, gen;dur=0');
    });

    // Without this header the browser hides serverTiming entirely on a
    // cross-origin response, which is every real request here -- the web app
    // and the API are always different origins.
    it("allows its own front end to read those timings, and nobody else", async () => {
      generateSpeechWithTimings.mockResolvedValue({
        buffer: Buffer.from("RIFF"),
        cacheTier: "l1",
        queueMs: 0,
        generateMs: 0,
      });

      const allowed = await app.inject({
        method: "POST",
        url: "/api/tts",
        headers: { origin: "http://localhost:3000" },
        payload: { text: "hello", voice: "af_heart" },
      });
      expect(allowed.headers["timing-allow-origin"]).toBe("http://localhost:3000");

      const stranger = await app.inject({
        method: "POST",
        url: "/api/tts",
        headers: { origin: "https://example.com" },
        payload: { text: "hello", voice: "af_heart" },
      });
      expect(stranger.headers["timing-allow-origin"]).toBeUndefined();
    });
  });

  describe("POST /api/tts/warm", () => {
    it("rejects a missing, non-array, or empty texts field", async () => {
      expect((await app.inject({ method: "POST", url: "/api/tts/warm", payload: { voice: "af_heart" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: "hello", voice: "af_heart" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: [], voice: "af_heart" } })).statusCode).toBe(400);
    });

    it("rejects entries that aren't non-empty strings", async () => {
      const res = await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: ["ok", "  "], voice: "af_heart" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_texts");
    });

    it("bounds how many chunks one call can queue", async () => {
      const res = await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: Array(9).fill("hello"), voice: "af_heart" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("too_many_texts");
    });

    it("bounds the total characters one call can queue", async () => {
      // Individually under the per-text ceiling, collectively over the total.
      const res = await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: Array(4).fill("a".repeat(900)), voice: "af_heart" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("texts_too_long");
    });

    it("applies the same voice and speed validation as the real route", async () => {
      const badVoice = await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: ["hi"], voice: "nope" } });
      expect(badVoice.statusCode).toBe(400);
      expect(badVoice.json().error).toBe("invalid_voice");

      const badSpeed = await app.inject({ method: "POST", url: "/api/tts/warm", payload: { texts: ["hi"], voice: "af_heart", speed: 9 } });
      expect(badSpeed.statusCode).toBe(400);
      expect(badSpeed.json().error).toBe("invalid_speed");
    });
  });
});
