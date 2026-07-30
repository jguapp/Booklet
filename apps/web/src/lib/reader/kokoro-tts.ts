/**
 * Open-source, zero-cost TTS: Kokoro (Apache-2.0, 82M params) running
 * entirely client-side via kokoro-js (built on @huggingface/transformers --
 * WASM/WebGPU + ONNX Runtime Web). No server, no API key, no per-request
 * cost -- the ~90MB quantized model downloads once from Hugging Face's CDN
 * on first use and is cached by the browser (transformers.js's own model
 * cache) after that. See use-text-to-speech.ts for how this plugs into the
 * existing play/pause/resume/stop reader controls, falling back to the
 * native SpeechSynthesis engine when a voice isn't selected or this fails
 * to load (unsupported browser, network hiccup on first download).
 */
import { KokoroTTS } from "kokoro-js";

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

/** Kokoro ships 20+ voices (see tts.list_voices() for the full set) -- this
 * is a curated subset of the ones its own metadata grades highest for
 * quality, spanning both genders and American/British English. */
export const KOKORO_VOICES: KokoroVoiceOption[] = [
  { id: "af_heart", label: "Heart (American, female)" },
  { id: "af_bella", label: "Bella (American, female)" },
  { id: "af_nicole", label: "Nicole (American, female)" },
  { id: "am_michael", label: "Michael (American, male)" },
  { id: "am_fenrir", label: "Fenrir (American, male)" },
  { id: "bf_emma", label: "Emma (British, female)" },
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

// `"gpu" in navigator` only proves the WebGPU *API* exists -- it doesn't
// mean a real adapter is available. Confirmed by hand: on a real Windows
// Chromium without a usable GPU adapter, `navigator.gpu` exists but
// `requestAdapter()` resolves to `null` ("No available adapters." logged
// by the browser itself), and onnxruntime-web's WebGPU backend just hangs
// rather than cleanly failing when handed that. Actually requesting an
// adapter first (and falling back to wasm if it comes back null) avoids
// that hang instead of only checking whether the API is present.
async function pickDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return "wasm";
  try {
    const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/** Loaded once per page session and reused for every voice/article after
 * that -- the model itself doesn't depend on which voice is picked (voices
 * are small per-voice style vectors applied at generation time, not
 * separate models). */
export function loadKokoro(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = pickDevice()
      .then((device) => KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device }))
      .catch((err: unknown) => {
        ttsPromise = null; // don't cache a permanent failure -- allow retry on the next play()
        throw err;
      });
  }
  return ttsPromise;
}
