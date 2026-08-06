import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";

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
