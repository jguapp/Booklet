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
 * Chunking still happens here, client-side, before sending each chunk as
 * its own request -- same reasoning as the old WASM-era chunker (a whole
 * article in one call means no audio until the whole thing finishes), plus
 * it keeps each request small and bounded (see tts.ts's MAX_TEXT_LENGTH).
 */
import { KOKORO_VOICES, NATIVE_VOICE_ID, isKokoroVoice, type TtsVoiceOption } from "@booklet/shared";
import { apiFetchBlob } from "@/lib/api/client";

export type { TtsVoiceOption as KokoroVoiceOption };
export { KOKORO_VOICES, NATIVE_VOICE_ID, isKokoroVoice };

/** Generates one chunk of speech via the server and returns it as a
 * playable WAV Blob. Each call is a real, independent HTTP request -- see
 * use-tts-player.ts for how chunks are requested one ahead of playback
 * (simple fetch-ahead pipelining; unlike the old WASM Worker, a network
 * request doesn't block anything locally, so no Worker is needed to
 * achieve overlap this time). No auth needed -- same as the route itself,
 * see tts.ts. */
export function generateKokoroChunk(text: string, voice: string, speed: number): Promise<Blob> {
  return apiFetchBlob("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed }),
    auth: false,
  });
}

// The server caps a single request at 1000 characters (tts.ts's
// MAX_TEXT_LENGTH), but this is deliberately much smaller -- confirmed by
// hand that generation time scales with chunk length (roughly linear:
// ~4.7s for a ~100-char sentence in isolation, ~20s+ for a full 500-char
// chunk), and the FIRST chunk's generation time is exactly what "time to
// first audio" is. A larger chunk means fewer total requests, but with
// fetch-ahead pipelining already covering the overlap between chunks (see
// tts-player-provider.tsx), that saving matters far less than a fast
// start does -- especially since the user has to wait for chunk one
// specifically before hearing anything at all.
const MAX_CHUNK_CHARS = 200;

// Readability keeps figure captions and photo-credit lines as ordinary
// body text (there's no structural marker left once an article's HTML has
// been flattened to plain text) -- fine to *see* next to the image, but
// read aloud they're a short, out-of-context non-sequitur that interrupts
// the actual article ("Image credit: Getty Images" mid-sentence-flow).
// Matched by their distinctive leading "Label: " / "Label by " shape,
// which real prose essentially never starts a sentence with.
const CAPTION_LINE_PATTERN =
  /^(image|photo|photograph|illustration|screenshot|graphic|credit|credits|courtesy|source|caption)s?\s*(:|-|—|by)\s+/i;

// Accumulates across paragraph/newline boundaries, not just within one --
// confirmed by hand this matters a lot: a real Wikipedia article's
// extracted text includes infobox/taxonomy content (species classification
// tables, geological-period abbreviations, citation lists) as hundreds of
// newline-separated one-to-few-character fragments with no real sentence
// punctuation. Resetting the accumulator at every paragraph boundary (an
// earlier version of this function did) turned each of those into its own
// chunk -- 2283 chunks, most under 20 characters, for one article -- which
// meant 2283 separate HTTP round trips before "read aloud" finished a
// single Wikipedia page. Treating the whole text as one continuous stream
// of sentences and only flushing a chunk once it's actually close to
// MAX_CHUNK_CHARS fixes this: those fragments just get grouped together
// into normally-sized chunks instead of each paying its own request.
export function toSafeTextChunks(text: string): string[] {
  const chunks: string[] = [];
  // Collapses *every* whitespace run (not just newlines) before splitting
  // into sentences -- article-content.tsx's read-along re-derives this
  // same "\s+ -> single space" normalization independently when locating a
  // chunk in the DOM (see its own comment), on the assumption that doing
  // so to an already-emitted chunk is a no-op. It wasn't always: a chunk
  // built from source text with a stray multi-space or tab run (common in
  // real extracted infobox/table content) kept that run verbatim, so
  // article-content.tsx's *independent* re-collapsing of the same text
  // shortened it by however many characters that run had -- silently
  // shifting every offset after that point out of alignment with
  // readingWordRange (computed against *this* function's raw, uncollapsed
  // output in tts-player-provider.tsx). Collapsing here, once, at the
  // source, means both sides are always looking at the identical string.
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];

  let piece = "";
  const flush = () => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
    piece = "";
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence || CAPTION_LINE_PATTERN.test(sentence)) continue;

    if (sentence.length > MAX_CHUNK_CHARS) {
      // A single sentence too long on its own (rare, but e.g. text with no
      // punctuation at all) -- flush whatever's accumulated, then hard-wrap
      // this one at word boundaries so no single request ever exceeds the
      // cap.
      flush();
      const words = sentence.match(/\S+\s*/g) ?? [sentence];
      for (const word of words) {
        if (piece.length + word.length > MAX_CHUNK_CHARS && piece) flush();
        piece += word;
      }
      flush();
      continue;
    }

    if (piece.length + sentence.length + 1 > MAX_CHUNK_CHARS && piece) flush();
    piece += (piece ? " " : "") + sentence;
  }
  flush();

  return chunks;
}
