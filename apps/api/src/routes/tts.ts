import type { FastifyInstance } from "fastify";
import { KOKORO_VOICE_IDS } from "@booklet/shared";
import { generateSpeechPooled } from "../services/tts-pool.js";

/**
 * Public (no auth) -- same reasoning as /api/extract: TTS doesn't persist
 * or touch any user data, and gating it behind an account would break
 * "everything works signed out" for zero reason. Unlike extraction, each
 * call is real, non-trivial server compute (a Kokoro forward pass, ~5s --
 * see tts-service.ts), so the rate limit here is deliberately tighter than
 * extract's -- this is the one route in this app with a real per-request
 * cost that isn't just proxying a fetch.
 */
const TTS_LIMIT = {
  max: process.env.NODE_ENV === "production" ? 60 : 2000,
  timeWindow: "10 minutes",
};

// A generous ceiling over the client's own ~500-char chunking (see
// apps/web/src/lib/reader/tts-client.ts) -- defense in depth against a
// request that bypasses the client's own chunking and asks this route,
// now a real compute cost instead of free WASM, to generate an entire
// article in one call.
const MAX_TEXT_LENGTH = 1000;

interface TtsRequestBody {
  text?: string;
  voice?: string;
  speed?: number;
}

export async function registerTtsRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TtsRequestBody }>("/api/tts", { config: { rateLimit: TTS_LIMIT } }, async (request, reply) => {
    const { text, voice, speed = 1 } = request.body ?? {};

    if (typeof text !== "string" || !text.trim()) {
      return reply.code(400).send({ error: "invalid_text", message: "Non-empty text is required." });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return reply
        .code(400)
        .send({ error: "text_too_long", message: `Text must be ${MAX_TEXT_LENGTH} characters or fewer per request.` });
    }
    if (typeof voice !== "string" || !KOKORO_VOICE_IDS.has(voice)) {
      return reply.code(400).send({ error: "invalid_voice", message: "Unknown voice id." });
    }
    if (typeof speed !== "number" || speed < 0.5 || speed > 2) {
      return reply.code(400).send({ error: "invalid_speed", message: "speed must be between 0.5 and 2." });
    }

    try {
      const wav = await generateSpeechPooled(text, voice, speed);
      return reply.header("Cache-Control", "no-store").type("audio/wav").send(wav);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Speech generation failed.";
      return reply.code(500).send({ error: "generation_failed", message });
    }
  });
}
