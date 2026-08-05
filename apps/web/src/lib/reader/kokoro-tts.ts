/**
 * Open-source, zero-cost TTS: Kokoro (Apache-2.0, 82M params) running
 * entirely client-side via kokoro-js (built on @huggingface/transformers --
 * WASM + ONNX Runtime Web; WebGPU is deliberately not used, see DEVICE
 * below). No server, no API key, no per-request cost -- the ~90MB
 * quantized model downloads once from Hugging Face's CDN on first use and
 * is cached by the browser (transformers.js's own model cache) after that.
 * See use-text-to-speech.ts for how this plugs into the existing
 * play/pause/resume/stop reader controls, falling back to the native
 * SpeechSynthesis engine when a voice isn't selected or this fails to load
 * (unsupported browser, network hiccup on first download).
 */
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

// ONNX Runtime Web logs a harmless perf-advisory notice at session-creation
// time ("some nodes were not assigned to the preferred execution
// provider") via console.error, at "warning" severity -- alarming for
// something that isn't actually a failure (audio still generates and
// plays correctly regardless). The obvious fix -- env.backends.onnx.
// logLevel -- doesn't reach it: that JS-side setting is a different knob
// from the WASM session's own internal logSeverityLevel (which is what
// actually gates this message, defaulting to "warning" inside
// onnxruntime-web itself, independent of env.logLevel). The *real* lever,
// passing `session_options: { logSeverityLevel: 3 }` into
// KokoroTTS.from_pretrained(), doesn't work either: kokoro-js's own
// from_pretrained() wrapper destructures only { dtype, device,
// progress_callback } out of its options and silently drops anything
// else, so there's no way to reach the underlying session options through
// its public API at all. Confirmed by hand -- the previous attempt with
// env.backends.onnx.logLevel = "error" still let the exact same
// console.error lines through in a real browser. With no real API lever
// available, filtering the message at the console level, scoped tightly
// to just the model-load call (not installed globally for the app's
// lifetime), is what's actually left.
const ORT_BENIGN_NOISE = /VerifyEachNodeIsAssignedToAnEp|Rerunning with verbose output/;

async function withOrtNoiseSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && ORT_BENIGN_NOISE.test(args[0])) return;
    originalConsoleError(...args);
  };
  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
  }
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** kokoro-js types `generate()`'s voice option as a literal union of its
 * exact voice ids (not exported directly), derived here from the method's
 * own signature so callers can cast a validated string into it without
 * hand-duplicating that union. See use-text-to-speech.ts. */
export type KokoroVoiceId = NonNullable<Parameters<KokoroTTS["generate"]>[1]>["voice"];

export interface KokoroVoiceOption {
  id: string;
  label: string;
}

/** Kokoro ships 28 voices (see tts.list_voices() for the full set, or
 * kokoro-js's own bundled quality metadata -- each voice has a
 * `targetQuality`/`overallGrade`). This is every voice graded C or better,
 * spanning both genders and American/British English -- the D-and-below
 * voices are real but audibly rougher, so they're left out rather than
 * padding the picker with options that sound worse than the system voice. */
export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: "af_heart", label: "Heart (American, female)" },
  { id: "af_bella", label: "Bella (American, female)" },
  { id: "af_nicole", label: "Nicole (American, female)" },
  { id: "af_aoede", label: "Aoede (American, female)" },
  { id: "af_kore", label: "Kore (American, female)" },
  { id: "af_sarah", label: "Sarah (American, female)" },
  { id: "am_michael", label: "Michael (American, male)" },
  { id: "am_fenrir", label: "Fenrir (American, male)" },
  { id: "am_puck", label: "Puck (American, male)" },
  { id: "bf_emma", label: "Emma (British, female)" },
  { id: "bf_isabella", label: "Isabella (British, female)" },
  { id: "bm_george", label: "George (British, male)" },
  { id: "bm_fable", label: "Fable (British, male)" },
];

/** The device's own SpeechSynthesis voice -- the default, since it needs no
 * download at all. Kept as a real option (not just "off") in the same
 * picker as the Kokoro voices. */
export const NATIVE_VOICE_ID = "system";

export function isKokoroVoice(voiceId: string): boolean {
  return voiceId !== NATIVE_VOICE_ID;
}

// WebGPU is deliberately never used, even when available -- confirmed by
// hand (raw sample inspection, not just "it sounds off") that
// onnxruntime-web's WebGPU backend produces numerically-corrupted output
// for this model on real Windows Chromium: generated samples came back
// with |value| up to ~10^26 (valid audio is within [-1, 1]), regardless of
// dtype (reproduced with both "q8" and "fp32" -- the fp32 device="webgpu"
// combination the kokoro-js README itself recommends). Encoded into a WAV
// and played, that's exactly what "loads forever, then a burst of static"
// is -- not a WASM/WebGPU speed tradeoff, a genuine correctness bug in the
// WebGPU execution path for this model/environment. WASM has none of this
// (confirmed: sample magnitudes stay within [-1, 1], real speech).
const DEVICE = "wasm";

let ttsPromise: Promise<KokoroTTS> | null = null;

/** Loaded once per page session and reused for every voice/article after
 * that -- the model itself doesn't depend on which voice is picked (voices
 * are small per-voice style vectors applied at generation time, not
 * separate models).
 *
 * Generation is genuinely slow regardless of threading -- confirmed by
 * hand, isolated from all app/chunking overhead: a single realistic
 * ~20-word sentence takes 12-18s via this model's own generate() call.
 * next.config.ts sets Cross-Origin-Opener-Policy/Cross-Origin-Embedder-
 * Policy on /reader/* (lets SharedArrayBuffer exist there, which
 * onnxruntime-web's WASM backend needs for multi-threading) but confirmed
 * this doesn't move the needle here -- the bottleneck is this 82M-param
 * model's raw per-token WASM inference cost, not thread count. Left as
 * real, correct config (harmless, free on a hard navigation) but nothing
 * in the app forces one just for this. */
export function loadKokoro(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = withOrtNoiseSuppressed(() => KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: DEVICE })).catch(
      (err: unknown) => {
        ttsPromise = null; // don't cache a permanent failure -- allow retry on the next play()
        throw err;
      },
    );
  }
  return ttsPromise;
}

// kokoro-js's own sentence splitter (TextSplitterStream) has a real bug:
// handed one huge single blob of text in a single push() call -- a whole
// multi-thousand-word article, not one sentence -- it can hang forever
// (confirmed by hand: fed a real 51KB Wikipedia article's extracted text,
// TextSplitterStream.push() never returned, even isolated from the rest of
// this app in a plain Node script with no browser/WASM/GPU involved at
// all). This is what "TTS says loading forever, then the tab crashes"
// actually was -- not a WebGPU issue, not a memory issue (though the dev
// server *had* also ballooned to 9.6GB after this many hours in one
// session, which didn't help but wasn't the real bug). Feeding it in much
// smaller pieces sidesteps the hang entirely: confirmed the same real
// article's text completes in ~60ms when pre-split into paragraph-sized
// pieces first (its own sentence-boundary logic still runs correctly
// across each incremental push -- it glues a sentence split mid-piece
// back together using the next piece on its own, so this pre-chunking
// doesn't need to land on exact sentence boundaries, just keep every
// individual push() small).
const MAX_SAFE_CHUNK_CHARS = 500;

function pushSafely(stream: TextSplitterStream, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length <= MAX_SAFE_CHUNK_CHARS) {
    stream.push(trimmed);
    return;
  }
  // A single paragraph can still be too large on its own (e.g. text with no
  // line breaks at all, like some PDF extractions) -- fall back to sentence
  // boundaries, and as a last resort hard word-wrapping, so no single
  // push() call ever sees more than MAX_SAFE_CHUNK_CHARS.
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [trimmed];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_SAFE_CHUNK_CHARS) {
      stream.push(sentence);
      continue;
    }
    const words = sentence.match(new RegExp(`\\S+\\s*`, "g")) ?? [sentence];
    let piece = "";
    for (const word of words) {
      if (piece.length + word.length > MAX_SAFE_CHUNK_CHARS && piece) {
        stream.push(piece);
        piece = "";
      }
      piece += word;
    }
    if (piece) stream.push(piece);
  }
}

export function toSafeTextStream(text: string): TextSplitterStream {
  const stream = new TextSplitterStream();
  for (const paragraph of text.split(/\n+/)) {
    pushSafely(stream, paragraph);
  }
  stream.close();
  return stream;
}
