/**
 * Open-source TTS: Kokoro (Apache-2.0, 82M params), now generated
 * server-side (apps/api's POST /api/tts, via kokoro-js + onnxruntime-node)
 * rather than in-browser over WASM. This module is a thin API client --
 * see apps/api/src/services/tts-service.ts for why this moved server-side
 * (WASM's real per-chunk cost, ~12-18s, never came down no matter what was
 * tried client-side: Worker-based pipelining, quantization, threading;
 * native Node execution measured at ~4.7s for the same sentence on the
 * same machine, a real ~2.5-3.8x improvement, not a config tweak).
 *
 * Chunking still happens client-side, before sending each chunk as its own
 * request -- same reasoning as the old WASM-era chunker (a whole article in
 * one call means no audio until the whole thing finishes), plus it keeps
 * each request small and bounded (see tts.ts's MAX_TEXT_LENGTH). The
 * chunker itself now lives in @booklet/shared so it can be unit-tested;
 * this module re-exports it (see the bottom of the file).
 */
import { KOKORO_VOICES, NATIVE_VOICE_ID, isKokoroVoice, type TtsVoiceOption } from "@booklet/shared";
import { apiFetch, apiFetchBlob } from "@/lib/api/client";

export type { TtsVoiceOption as KokoroVoiceOption };
export { KOKORO_VOICES, NATIVE_VOICE_ID, isKokoroVoice };

/** Generates one chunk of speech via the server and returns it as a
 * playable WAV Blob. Each call is a real, independent HTTP request -- see
 * use-tts-player.ts for how chunks are requested one ahead of playback
 * (simple fetch-ahead pipelining; unlike the old WASM Worker, a network
 * request doesn't block anything locally, so no Worker is needed to
 * achieve overlap this time). No auth needed -- same as the route itself,
 * see tts.ts.
 *
 * `signal`, when passed, lets the caller actually cancel this request --
 * stopping playback used to just stop *consuming* the result client-side
 * while the fetch (and the server-side generation behind it) kept running
 * to completion regardless, tying up a pool worker for audio nothing would
 * ever play. Aborting the fetch closes the connection, which the server
 * can detect and use to free that capacity up immediately instead of
 * finishing pointless work. */
export function generateKokoroChunk(text: string, voice: string, speed: number, signal?: AbortSignal): Promise<Blob> {
  return apiFetchBlob("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
    auth: false,
    signal,
  });
}

/**
 * Asks the server to generate these chunks into its cache without sending
 * any audio back -- fire-and-forget, resolves as soon as the server has
 * accepted the request rather than when generation finishes.
 *
 * Used for the chunks *after* the one the player holds itself: they only
 * need to be cache hits by the time playback reaches them, not to be in the
 * browser's hands up front. Warming them this way costs one small request
 * instead of downloading several hundred kilobytes of audio that a reader
 * who never presses play would never have used.
 *
 * Failures are swallowed: a warm that didn't happen just means that chunk
 * gets generated normally when playback reaches it, which is exactly the
 * behavior that existed before warming.
 */
export function warmKokoroChunks(texts: string[], voice: string, speed: number, signal?: AbortSignal): void {
  if (texts.length === 0) return;
  void apiFetch("/api/tts/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, voice, speed }),
    auth: false,
    signal,
  }).catch(() => {});
}

// Chunking itself lives in @booklet/shared (tts-chunking.ts) -- moved there
// so it can actually be unit-tested, which apps/web has no runner for. Two
// real first-chunk sizing bugs shipped because of that gap; see that file's
// own header. Re-exported here so every existing caller keeps importing it
// from the same place it always did.
export { toSafeTextChunks, FIRST_CHUNK_MAX_CHARS, MAX_CHUNK_CHARS, HARD_WRAP_MAX_CHARS } from "@booklet/shared";
