/**
 * Open-source, zero-cost TTS: Piper (MIT, via @mintplex-labs/piper-tts-web)
 * running entirely client-side over onnxruntime-web's WASM backend. No
 * server, no API key, no per-request cost -- each voice's ~60-80MB model
 * downloads once from Hugging Face's CDN on first use and is cached in OPFS
 * after that. See use-text-to-speech.ts for how this plugs into the
 * existing play/pause/resume/stop reader controls, falling back to the
 * native SpeechSynthesis engine when a voice isn't selected or this fails
 * to load (unsupported browser, network hiccup on first download).
 *
 * Replaced Kokoro (onnx-community/Kokoro-82M-v1.0-ONNX) for issue #93:
 * confirmed by hand, same test sentence, same environment, same "load once
 * generate twice" shape -- Kokoro's own generate() took 12-18s per
 * ~20-word sentence (a genuine WASM inference-cost bottleneck, not a config
 * issue; WebGPU was tried and produces numerically-corrupted output for
 * that model on this stack). Piper generates the same kind of sentence in
 * 1.5-2.5s, comfortably inside the 1-3s time-to-first-speech target.
 */
import { TtsSession, WASM_BASE, type VoiceId } from "@mintplex-labs/piper-tts-web";

export type PiperVoiceId = VoiceId;

export interface PiperVoiceOption {
  id: PiperVoiceId;
  label: string;
}

/** Piper ships 100+ voices across many languages/quality tiers (see the
 * package's own `voices()`) -- this is a curated set of "medium" quality
 * (the same tier as the one benchmarked for #93) English voices, spanning
 * both genders and American/British accents. */
export const PIPER_VOICES: PiperVoiceOption[] = [
  { id: "en_US-hfc_female-medium", label: "Heart (American, female)" },
  { id: "en_US-amy-medium", label: "Amy (American, female)" },
  { id: "en_US-kristin-medium", label: "Kristin (American, female)" },
  { id: "en_US-hfc_male-medium", label: "Liam (American, male)" },
  { id: "en_US-ryan-medium", label: "Ryan (American, male)" },
  { id: "en_GB-alba-medium", label: "Alba (British, female)" },
  { id: "en_GB-alan-medium", label: "Alan (British, male)" },
  { id: "en_GB-northern_english_male-medium", label: "Northern English (British, male)" },
];

/** The device's own SpeechSynthesis voice -- the default, since it needs no
 * download at all. Kept as a real option (not just "off") in the same
 * picker as the Piper voices. */
export const NATIVE_VOICE_ID = "system";

export function isPiperVoice(voiceId: string): boolean {
  return voiceId !== NATIVE_VOICE_ID;
}

// Unlike Kokoro (one shared model, small per-voice style vectors applied at
// generation time), every Piper voice is its own separate ONNX model --
// switching voices means a new ~60-80MB download and a new inference
// session, not a free parameter swap. Sessions are cached per voice id so
// re-selecting an already-loaded voice is instant.
const sessions = new Map<PiperVoiceId, Promise<TtsSession>>();

export function loadPiper(voiceId: PiperVoiceId): Promise<TtsSession> {
  let session = sessions.get(voiceId);
  if (!session) {
    session = TtsSession.create({
      voiceId,
      // Only onnxWasm needs overriding: the package's hardcoded CDN pins
      // onnxruntime-web 1.18.0, which doesn't match the version actually
      // installed here (see package.json/copy-onnx-wasm.mjs) -- serving
      // that local copy instead. piperData/piperWasm are passed through at
      // their real defaults (WASM_BASE + ".data"/".wasm") rather than
      // hand-guessed a second time.
      wasmPaths: { onnxWasm: "/onnx-runtime/", piperData: `${WASM_BASE}.data`, piperWasm: `${WASM_BASE}.wasm` },
    }).catch((err: unknown) => {
      sessions.delete(voiceId); // don't cache a permanent failure -- allow retry on the next play()
      throw err;
    });
    sessions.set(voiceId, session);
  }
  return session;
}

// Piper's predict() is one-shot, not a stream -- handing it a whole
// multi-thousand-word article in one call would mean no audio plays until
// the entire thing finishes synthesizing, minutes away at this model's
// ~1s-of-generation-per-3s-of-audio rate. Splitting into sentence-grouped
// chunks (same shape as Kokoro's own chunking, adapted from a stream API to
// a plain array since Piper has no stream method) keeps time-to-first-
// speech to one chunk's generation time instead.
const MAX_CHUNK_CHARS = 500;

function pushSafely(chunks: string[], text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length <= MAX_CHUNK_CHARS) {
    chunks.push(trimmed);
    return;
  }
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [trimmed];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK_CHARS) {
      chunks.push(sentence);
      continue;
    }
    const words = sentence.match(/\S+\s*/g) ?? [sentence];
    let piece = "";
    for (const word of words) {
      if (piece.length + word.length > MAX_CHUNK_CHARS && piece) {
        chunks.push(piece);
        piece = "";
      }
      piece += word;
    }
    if (piece) chunks.push(piece);
  }
}

export function toSafeTextChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    pushSafely(chunks, paragraph);
  }
  return chunks;
}
