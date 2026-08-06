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
//
// Also caps how bad a *later* pause can get: the server's worker pool
// (tts-pool.ts) only runs a few real concurrent generation processes, so a
// chunk can't start generating until one of them actually frees up --
// prefetching earlier reserves a queue slot sooner but can't make a busy
// worker finish faster. Measured by hand: a short run of quick sentences
// (little playback time to hide behind) followed immediately by a chunk
// sitting at this cap took noticeably longer to generate than the short
// ones took to *play*, producing a real, audible pause even with prefetch
// working correctly. Was 200; lowered to 140 specifically to shrink that
// worst case -- a smaller cap can't make the mismatch impossible (a run of
// very short chunks can still outpace it), but it directly bounds how long
// any single chunk is allowed to take, at the cost of somewhat more total
// requests for the same amount of text.
const MAX_CHUNK_CHARS = 140;

// The very first chunk gets a smaller cap than the rest -- generation time
// scales with chunk length, and the first chunk's generation time IS
// "time to first audio" in the most literal sense: there's no previous
// chunk playing yet for the server's worker pool (tts-pool.ts) to work
// ahead of, so nothing hides that wait. Every chunk after the first
// already benefits from the pool plus the client's prefetch window (see
// tts-player-provider.tsx) covering its generation time with the previous
// chunk's playback -- there's no equivalent latency cost to keeping those
// at the normal, more request-efficient size, so only chunk one pays for
// a faster start.
const FIRST_CHUNK_MAX_CHARS = 80;

// How long a *single sentence* has to be before it's forced into more than
// one chunk -- deliberately much higher than either cap above. Sentences
// were being hard-wrapped whenever they alone exceeded the *accumulation*
// cap (MAX_CHUNK_CHARS/FIRST_CHUNK_MAX_CHARS), which sounded fine when that
// cap was 200, but lowering it to 140 (see MAX_CHUNK_CHARS's own comment)
// pulled a lot of perfectly ordinary sentences into the hard-wrap path --
// confirmed by hand against a real article's actual sentence lengths: 45 of
// 553 sentences (8%) exceeded 140 chars, meaning 8% of this article's
// sentences were being torn into fragments and sent to Kokoro as separate,
// independently-synthesized requests. Two fragments of one sentence have no
// way to sound like a continuous utterance -- each gets its own prosody and
// edge silence, so what should be one flowing sentence comes out with an
// audible, unnatural break where the split happened, exactly the "weird
// stop mid-sentence" this exists to fix. A sentence between the normal cap
// and this one now becomes its own single chunk instead -- longer than the
// usual target, but spoken as the one continuous utterance it actually is.
// Only sentences past *this* threshold (in the same article: 5 of 553,
// ~1%) still get split, and even those try to break at a natural clause
// boundary first (see the wrap loop below) rather than an arbitrary word.
const HARD_WRAP_MAX_CHARS = 320;

// Readability keeps figure captions and photo-credit lines as ordinary
// body text (there's no structural marker left once an article's HTML has
// been flattened to plain text) -- fine to *see* next to the image, but
// read aloud they're a short, out-of-context non-sequitur that interrupts
// the actual article ("Image credit: Getty Images" mid-sentence-flow).
// Matched by their distinctive leading "Label: " / "Label by " shape --
// optionally a two-word label ("Image credit:", "Photo courtesy:"), since
// that's an extremely common real caption shape a single-word check
// misses entirely -- which real prose essentially never starts a sentence
// with. Deliberately *not* matching a bare hyphen/em-dash after the label
// word, and deliberately *not* matching "courtesy of" (only "courtesy:"):
// both were confirmed by hand to be real bugs, not just theoretical --
// real article prose routinely opens a sentence with one of these words
// used as an ordinary noun followed by an em-dash aside ("Illustration --
// a favorite technique of the era -- was used extensively...") or a
// "courtesy of" construction ("Courtesy of decades of research, the
// theory was eventually confirmed"), and matching either silently dropped
// the entire sentence -- occasionally an entire paragraph, since this
// runs per-sentence over the whole article -- from what got read aloud at
// all. A colon or "by" has no equivalent normal-prose false-positive shape.
const CAPTION_LINE_PATTERN =
  /^(image|photo|photograph|illustration|screenshot|graphic|credit|credits|courtesy|source|caption)s?(\s+(credit|credits|courtesy|caption)s?)?\s*(:|by)\s+/i;

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
  // chunks is still empty exactly until the first flush() actually pushes
  // something -- a direct, always-correct way to know whether the piece
  // being accumulated right now is destined to become chunk one.
  const currentCap = () => (chunks.length === 0 ? FIRST_CHUNK_MAX_CHARS : MAX_CHUNK_CHARS);

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence || CAPTION_LINE_PATTERN.test(sentence)) continue;

    if (sentence.length > HARD_WRAP_MAX_CHARS) {
      // A single sentence too long even for the generous hard-wrap
      // threshold (rare -- e.g. a run-on with no internal punctuation, or
      // real text with no punctuation at all) -- flush whatever's
      // accumulated, then wrap this one so no single request ever exceeds
      // the cap. Prefers breaking at the last clause boundary (comma,
      // semicolon, colon, em dash) before the cap over a raw word
      // boundary: natural speech already has a slight pause at those
      // marks, so a forced split there sounds like an ordinary breath
      // instead of an arbitrary cut mid-thought. Falls back to a plain
      // word boundary only when no clause punctuation exists in that span
      // at all.
      flush();
      const words = sentence.match(/\S+\s*/g) ?? [sentence];
      let lastClauseBreakLen = -1;
      for (const word of words) {
        if (piece.length + word.length > HARD_WRAP_MAX_CHARS && piece) {
          if (lastClauseBreakLen > 0) {
            const remainder = piece.slice(lastClauseBreakLen).trimStart();
            piece = piece.slice(0, lastClauseBreakLen).trim();
            flush();
            piece = remainder;
          } else {
            flush();
          }
          lastClauseBreakLen = -1;
        }
        piece += word;
        if (/[,;:—]\s*$/.test(word)) lastClauseBreakLen = piece.length;
      }
      flush();
      continue;
    }

    if (piece.length + sentence.length + 1 > currentCap() && piece) flush();
    piece += (piece ? " " : "") + sentence;
  }
  flush();

  return chunks;
}
