/**
 * Server-side Kokoro TTS (Apache-2.0, 82M params) via kokoro-js. This used
 * to run entirely client-side in the browser over onnxruntime-web's WASM
 * backend -- correct for "zero server cost", but genuinely slow: ~12-18s
 * per sentence, confirmed by hand, unaffected by threading or pipelining
 * (a WASM sandbox's per-token inference cost, not a config issue). Moved
 * here specifically for real speed: kokoro-js auto-detects a Node.js
 * environment and uses onnxruntime-node (real native execution, not a WASM
 * sandbox) automatically -- confirmed by hand, same model/voice/sentence,
 * same machine: ~4.7s per sentence, a real ~2.5-3.8x improvement over the
 * WASM baseline, not a config tweak.
 *
 * This is a real, deliberate trade against this app's "everything works
 * offline, zero server cost" principle everywhere else (OCR, extraction,
 * etc.) -- accepted explicitly for this feature because genuine speed
 * turned out to require it; WASM's ceiling was already explored at length
 * (Worker-based pipelining, quantization, threading) and none of it closed
 * the gap.
 */
import { availableParallelism } from "node:os";
import { KokoroTTS } from "kokoro-js";
import { AutoTokenizer, StyleTextToSpeech2Model } from "@huggingface/transformers";
import { toPcm16Wav } from "./wav-pcm16.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** kokoro-js types `generate()`'s voice option as a literal union of its
 * exact voice ids (not exported directly), derived here from the method's
 * own signature so the route's already-validated string can be cast
 * without hand-duplicating that union. */
type KokoroVoiceId = NonNullable<Parameters<KokoroTTS["generate"]>[1]>["voice"];

// ONNX Runtime logs a harmless perf-advisory notice at session-creation
// time via console.error -- see the identical comment this was copied from
// in the (now-removed) client-side kokoro-tts.ts for why there's no real
// API lever to suppress it instead.
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

// Loaded once for the life of the process, not per-request -- same
// reasoning as ocr-service.ts's shared OcrWorkerPool: the expensive part
// (loading the model) is a one-time cost that should never be paid inside
// a request. Real, measured cold-start cost the first time (2-5s normally;
// occasionally much longer against a rate-limited CDN -- see
// copy-onnx-wasm.mjs-era session notes -- but that's a deploy/startup
// concern, not something a request should ever wait on).
let ttsPromise: Promise<KokoroTTS> | null = null;

/**
 * How many threads this worker's ONNX session may use for a single operator.
 *
 * Left to ORT's default, each session sizes its intra-op pool to the whole
 * machine -- so N pool workers each try to use every core, and on a small
 * host that is contention, not concurrency. Measured on a 2-vCPU CI runner
 * with three unbounded workers: three concurrent generations took 2.86x a
 * single one (18725ms vs 6542ms), i.e. very nearly fully serialized, against
 * a pool header that claimed ~1x. See #162.
 *
 * Dividing the cores among the workers is what makes the pool's processes
 * actually run alongside each other instead of fighting. TTS_POOL_SIZE is
 * read here rather than imported to keep this module free of a dependency on
 * the pool that forks it -- the worker process is started by tts-pool.ts and
 * inherits its environment.
 */
function intraOpThreads(): number {
  const explicit = Number(process.env.TTS_INTRA_OP_THREADS);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);

  const poolSize = Math.max(1, Number(process.env.TTS_POOL_SIZE) || 3);
  const cores = Math.max(1, availableParallelism());
  // At least 1: on a 2-core host with a pool of 3 the honest answer is one
  // thread each and a pool larger than the machine, which tts-pool.ts's own
  // sizing now avoids -- but this must never produce 0.
  return Math.max(1, Math.floor(cores / poolSize));
}

function loadModel(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    // KokoroTTS.from_pretrained doesn't forward session_options, so the model
    // and tokenizer are constructed directly and handed to the constructor --
    // the same thing from_pretrained does internally, just with the ORT
    // session actually configured.
    ttsPromise = withOrtNoiseSuppressed(async () => {
      const session_options = { intraOpNumThreads: intraOpThreads(), interOpNumThreads: 1 };
      const [model, tokenizer] = await Promise.all([
        StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype: "q8", session_options }),
        AutoTokenizer.from_pretrained(MODEL_ID),
      ]);
      return new KokoroTTS(model, tokenizer);
    }).catch((err: unknown) => {
      ttsPromise = null; // don't cache a permanent failure -- allow retry on the next call
      throw err;
    });
  }
  return ttsPromise;
}

/** Loads the model, propagating failure to the caller. Used by the pool
 * worker, which has to report whether the load actually succeeded.
 *
 * This deliberately has no error-swallowing sibling. There used to be a
 * `warmTtsModel()` that caught and logged instead of throwing, and a worker
 * built on it reported "loaded" even when the load had failed -- the exact
 * lie /api/health exists to stop telling (#161). Caught for real: with the
 * weights CDN unreachable, health cheerfully reported loaded: 1. Anything
 * that only wants best-effort warming should catch here, at its own call
 * site, rather than reintroduce a load that cannot fail. */
export function loadTtsModel(): Promise<KokoroTTS> {
  return loadModel();
}

export class TtsGenerationError extends Error {}

export async function generateSpeech(text: string, voice: string, speed: number): Promise<Buffer> {
  const tts = await loadModel();
  let audio;
  try {
    // Cast is safe: the route validates `voice` against KOKORO_VOICE_IDS
    // (@booklet/shared) before calling this, which is exactly kokoro-js's
    // own set of real voice ids -- it just doesn't export that literal
    // union for callers to type against directly.
    audio = await tts.generate(text, { voice: voice as KokoroVoiceId, speed });
  } catch (err) {
    throw new TtsGenerationError(err instanceof Error ? err.message : String(err));
  }
  // Converted here, inside the worker process, rather than in the parent --
  // so the halving also applies to the structured clone that carries this
  // buffer back over IPC (see tts-pool.ts's `serialization: "advanced"`),
  // not just to the cache and the eventual HTTP response.
  return toPcm16Wav(Buffer.from(audio.toWav()));
}
