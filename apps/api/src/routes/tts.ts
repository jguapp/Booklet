import type { FastifyInstance } from "fastify";
import { KOKORO_VOICE_IDS } from "@booklet/shared";
import { isAllowedOrigin } from "../lib/cors.js";
import {
  generateSpeechPooled,
  generateSpeechWithTimings,
  ttsPoolStatus,
  ttsQueueDepth,
} from "../services/tts-pool.js";

/**
 * Public (no auth) -- same reasoning as /api/extract: TTS doesn't persist
 * or touch any user data, and gating it behind an account would break
 * "everything works signed out" for zero reason. Unlike extraction, each
 * call is real, non-trivial server compute (a Kokoro forward pass, ~5s --
 * see tts-service.ts), so the rate limit here is deliberately tighter than
 * extract's -- this is the one route in this app with a real per-request
 * cost that isn't just proxying a fetch.
 */
// Sized against what listening to a real article actually costs, which the
// previous value (60) was an order of magnitude below: the client chunks at
// ~140 chars (apps/web/src/lib/reader/kokoro-tts.ts), so 60 requests only
// covers ~8,400 characters -- roughly 1,200 words, about eight minutes of
// listening. A normal 2,000-word article exhausted the limit *mid-playback*,
// and because the client prefetches six chunks ahead it hit that wall as a
// burst rather than gradually. 600 covers ~84,000 characters per IP per ten
// minutes (~80 minutes of audio) -- generous for a household sharing one NAT
// address, while still bounding a scraper to 600 forward passes.
//
// Worth reading alongside app.ts's trustProxy comment: without that set
// correctly in production, this limit applies to the proxy's IP rather than
// per user, and no value here would be large enough.
const TTS_LIMIT = {
  max: Number(process.env.TTS_RATE_LIMIT_MAX) || (process.env.NODE_ENV === "production" ? 600 : 2000),
  timeWindow: "10 minutes",
};

// A generous ceiling over the client's own chunking (see
// apps/web/src/lib/reader/kokoro-tts.ts) -- defense in depth against a
// request that bypasses the client's own chunking and asks this route,
// now a real compute cost instead of free WASM, to generate an entire
// article in one call.
const MAX_TEXT_LENGTH = 1000;

/** The warm route returns no audio, so its cost per request is bounded by
 * the chunk limits below rather than by response size. Its own bucket, since
 * one reader-open legitimately fires one warm call plus one real chunk
 * fetch, and those shouldn't compete for the same allowance. */
const TTS_WARM_LIMIT = {
  max: Number(process.env.TTS_WARM_RATE_LIMIT_MAX) || (process.env.NODE_ENV === "production" ? 120 : 2000),
  timeWindow: "10 minutes",
};

/** Bounds a single warm call: enough for the opening few chunks of an
 * article, not enough to hand the pool an entire book. */
const MAX_WARM_CHUNKS = 8;
const MAX_WARM_TOTAL_CHARS = 2000;

/**
 * How deep the pool's queue may get before this route starts shedding.
 *
 * The rate limit above bounds one IP; it says nothing about how many IPs
 * there are, and this route is unauthenticated. Nothing else stood between a
 * few hundred distinct callers and an unbounded queue of multi-second
 * forward passes -- and queueing is the wrong response to more work than the
 * machine can do, because every waiting caller is holding a connection open
 * for audio that will arrive long after the reader has given up. The failure
 * is worse than it looks from the server side: the client requests chunks
 * in order, so a caller who waits two minutes for chunk 3 hears nothing at
 * all, rather than hearing something slightly late.
 *
 * A 503 is the honest answer to "we cannot do this right now", and it is
 * also the actionable one -- the client's chunk loop already tolerates a
 * failed chunk, and Retry-After tells it when to come back instead of
 * leaving it to guess.
 *
 * Sized as a multiple of the pool rather than a flat number, because what
 * counts as "too deep" is entirely a function of how fast the queue drains.
 * At ~5s per forward pass, 8 deep per worker is roughly 40 seconds of
 * backlog: comfortably above the burst a single reader's prefetch produces
 * (six chunks ahead, and those are deduplicated by key), and well below the
 * point where waiting is pointless.
 */
const TTS_MAX_QUEUE_PER_WORKER = Number(process.env.TTS_MAX_QUEUE_PER_WORKER) || 8;

/** Seconds. Roughly the time it takes the queue to drain from the cap. */
const TTS_SHED_RETRY_AFTER_SECONDS = 30;

interface TtsRequestBody {
  text?: string;
  voice?: string;
  speed?: number;
}

interface TtsWarmRequestBody {
  texts?: unknown;
  voice?: string;
  speed?: number;
}

type VoiceSpeedCheck =
  | { ok: true; voice: string; speed: number }
  | { ok: false; error: string; message: string };

/** Shared by both routes so warming can never accept something the real
 * route would reject. Returns the narrowed values rather than just a
 * pass/fail so callers get the types without re-checking. */
function checkVoiceAndSpeed(voice: unknown, speed: unknown): VoiceSpeedCheck {
  if (typeof voice !== "string" || !KOKORO_VOICE_IDS.has(voice)) {
    return { ok: false, error: "invalid_voice", message: "Unknown voice id." };
  }
  if (typeof speed !== "number" || speed < 0.5 || speed > 2) {
    return { ok: false, error: "invalid_speed", message: "speed must be between 0.5 and 2." };
  }
  return { ok: true, voice, speed };
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
    const checked = checkVoiceAndSpeed(voice, speed);
    if (!checked.ok) return reply.code(400).send({ error: checked.error, message: checked.message });

    // Shed before enqueuing, not after. Checked here rather than inside the
    // pool because the pool has no reply to send -- and because warming and
    // the podcast generator legitimately queue past this point, while an
    // anonymous request for audio nobody is waiting on yet does not.
    //
    // Math.max(1, ...) because the pool spawns lazily: workers is 0 until the
    // first request, and a cap of zero would shed the very request that
    // starts the pool.
    const { workers } = ttsPoolStatus();
    const maxQueueDepth = Math.max(1, workers) * TTS_MAX_QUEUE_PER_WORKER;
    if (ttsQueueDepth() >= maxQueueDepth) {
      request.log.warn({ queueDepth: ttsQueueDepth(), maxQueueDepth }, "[tts] shedding load");
      return reply
        .code(503)
        .header("Retry-After", String(TTS_SHED_RETRY_AFTER_SECONDS))
        .send({ error: "overloaded", message: "Speech generation is busy right now. Try again shortly." });
    }

    try {
      const result = await generateSpeechWithTimings(text, checked.voice, checked.speed);

      // Where the server's share of TTFA actually went, readable in the
      // browser via PerformanceResourceTiming#serverTiming -- so a slow chunk
      // in the field can be attributed to queueing, generation, or neither (a
      // cache hit) without needing server-side log access.
      reply.header(
        "Server-Timing",
        [`cache;desc="${result.cacheTier}"`, `queue;dur=${result.queueMs}`, `gen;dur=${result.generateMs}`].join(", "),
      );
      // Without this the browser exposes serverTiming as an empty array on a
      // cross-origin response, making the header above pure overhead -- and
      // the API is always a different origin from the web app here. Echoes
      // the caller's own origin, gated by the same check CORS uses, rather
      // than "*": "*" would expose these timings to any site that fetched the
      // route, and a bare WEB_ORIGIN would miss both dev (any localhost port)
      // and the browser extension.
      const origin = request.headers.origin;
      if (origin && isAllowedOrigin(origin)) reply.header("Timing-Allow-Origin", origin);

      // `private, max-age` rather than `no-store`. Browsers don't HTTP-cache a
      // POST either way, so this changes nothing today -- but `no-store`
      // additionally *forbids* a Service Worker from cache.put()ing the
      // response, which would foreclose that option later. `private` keeps it
      // out of any shared/CDN cache, which matters because the response body
      // is derived from whatever the user happens to be reading.
      return reply.header("Cache-Control", "private, max-age=86400").type("audio/wav").send(result.buffer);
    } catch (err) {
      // Log the real error, return a fixed one: this route is public and
      // unauthenticated, and `err.message` here comes straight from
      // onnxruntime/kokoro-js internals (file paths, node names, model
      // details) -- not something to hand to an anonymous caller.
      request.log.error({ err }, "[tts] speech generation failed");
      return reply.code(500).send({ error: "generation_failed", message: "Speech generation failed." });
    }
  });

  /**
   * Speculative warming: "the reader just opened this article, so its opening
   * chunks are probably about to be wanted." Returns 202 immediately without
   * waiting for (or returning) any audio -- the results land in the cache, so
   * when play is actually pressed those chunks are hits rather than
   * multi-second generations.
   *
   * Why a separate route rather than the client just fetching the chunks it
   * wants warmed: a reader who opens an article and doesn't press play should
   * not have downloaded a megabyte of audio. Warming chunk one client-side
   * (the player keeps that blob in hand, so it can start instantly) and the
   * next couple server-side gets the latency benefit for a fraction of the
   * bandwidth, and for readers who bounce, none of it is transferred at all.
   *
   * Enqueued at low priority (see tts-pool.ts), so this can only ever use
   * pool capacity that would otherwise be idle and can never delay audio
   * someone is actually waiting on.
   */
  app.post<{ Body: TtsWarmRequestBody }>(
    "/api/tts/warm",
    { config: { rateLimit: TTS_WARM_LIMIT } },
    async (request, reply) => {
      const { texts, voice, speed = 1 } = request.body ?? {};

      if (!Array.isArray(texts) || texts.length === 0) {
        return reply.code(400).send({ error: "invalid_texts", message: "A non-empty texts array is required." });
      }
      if (texts.length > MAX_WARM_CHUNKS) {
        return reply
          .code(400)
          .send({ error: "too_many_texts", message: `At most ${MAX_WARM_CHUNKS} texts per request.` });
      }
      if (!texts.every((t): t is string => typeof t === "string" && t.trim().length > 0)) {
        return reply.code(400).send({ error: "invalid_texts", message: "Every text must be a non-empty string." });
      }
      if (texts.some((t) => t.length > MAX_TEXT_LENGTH)) {
        return reply
          .code(400)
          .send({ error: "text_too_long", message: `Text must be ${MAX_TEXT_LENGTH} characters or fewer per request.` });
      }
      if (texts.reduce((sum, t) => sum + t.length, 0) > MAX_WARM_TOTAL_CHARS) {
        return reply
          .code(400)
          .send({ error: "texts_too_long", message: `At most ${MAX_WARM_TOTAL_CHARS} characters per request.` });
      }

      const checked = checkVoiceAndSpeed(voice, speed);
      if (!checked.ok) return reply.code(400).send({ error: checked.error, message: checked.message });

      // Deliberately not awaited: the caller gets its 202 straight away and
      // never learns whether generation succeeded, because there is nothing
      // useful it could do with that information -- a failed warm just means
      // the chunk gets generated normally when play is pressed. Failures are
      // logged rather than surfaced.
      for (const text of texts) {
        void generateSpeechPooled(text, checked.voice, checked.speed, { speculative: true }).catch((err: unknown) => {
          request.log.warn({ err }, "[tts] speculative warm failed");
        });
      }

      return reply.code(202).send({ warming: texts.length });
    },
  );
}
