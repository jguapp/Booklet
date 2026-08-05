/**
 * Runs Kokoro (kokoro-js) off the main thread. Moved here specifically to
 * fix a real regression found by hand: pipelining generation ahead of
 * playback (start generating chunk N+1 as soon as chunk N starts playing,
 * instead of only once it finishes) sounds like a free win, but on the
 * main thread it made things worse -- kokoro-js's WASM inference is a
 * monolithic forward-pass call that doesn't yield back to the event loop
 * while it runs, so kicking off the next chunk's generation before the
 * current chunk's <audio> element had actually started playing starved
 * that playback of the thread it needed (confirmed: the "playing" status
 * never appeared within a 150s test budget). Moving generation to a
 * Worker removes that contention -- generation and playback now run on
 * genuinely separate threads, so the worker can run ahead on its own
 * pace instead of being gated by whatever the main thread happens to be
 * doing. See kokoro-tts.ts (the main-thread client) and
 * use-text-to-speech.ts (how chunks get played as they arrive).
 *
 * This does NOT reduce the model's actual per-chunk generation time
 * (12-18s/chunk, confirmed in isolation, unaffected by threading -- see
 * kokoro-tts.ts's own history). It only removes the dead silence a
 * sequential generate-then-play loop pays after every single chunk.
 */
import { KokoroTTS } from "kokoro-js";
import { toSafeTextStream, type KokoroVoiceId } from "../lib/reader/kokoro-tts";

// See chatterbox.worker.ts (or any other *.worker.ts in this project) for
// why this is `declare const self: Worker` rather than adding "webworker"
// to the project's tsconfig `lib` array: this project's lib is "dom" (used
// everywhere else), and "dom" + "webworker" declare incompatible globals
// (starting with `self` itself) if both are in scope at once. `Worker`
// (from "dom", the shape of a worker's handle as seen by its parent)
// happens to have the exact same postMessage/addEventListener shape
// actually needed inside the worker too.
declare const self: Worker;

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Same WebGPU-avoidance rationale as the original kokoro-tts.ts: confirmed
// by hand that onnxruntime-web's WebGPU backend produces numerically-
// corrupted output for this model on this stack (samples up to ~10^26;
// valid audio stays within [-1, 1]), regardless of dtype.
const DEVICE = "wasm";

// See kokoro-tts.ts's former version of this comment (still accurate,
// duplicated here since the model-loading call that actually triggers this
// warning now lives in this file): ONNX Runtime Web logs a harmless
// perf-advisory notice via console.error at session-creation time that
// there's no real API lever to suppress -- kokoro-js's from_pretrained()
// wrapper silently drops any options beyond dtype/device/progress_callback,
// so session_options never reaches the underlying session. Filtering the
// message at the console level, scoped to just the model-load call, is
// what's actually left.
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

let ttsPromise: Promise<KokoroTTS> | null = null;

function loadModel(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = withOrtNoiseSuppressed(() => KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: DEVICE })).catch(
      (err: unknown) => {
        ttsPromise = null; // don't cache a permanent failure -- allow retry on the next load
        throw err;
      },
    );
  }
  return ttsPromise;
}

// Bumped on every "cancel" message (sent by the main thread when playback
// is stopped/abandoned early -- see kokoro-tts.ts's streamKokoro()) so an
// in-flight generate loop knows to stop posting further chunks for a
// generation nobody wants anymore, instead of grinding through the rest of
// an article's text for nothing.
let currentGeneration = 0;

async function generate(text: string, voice: KokoroVoiceId, speed: number) {
  const myGeneration = ++currentGeneration;
  const tts = await loadModel();
  if (currentGeneration !== myGeneration) return; // cancelled while the model was loading

  for await (const { audio } of tts.stream(toSafeTextStream(text), { voice, speed })) {
    if (currentGeneration !== myGeneration) return; // cancelled mid-stream
    self.postMessage({ type: "chunk", data: { blob: audio.toBlob() } });
  }
  if (currentGeneration === myGeneration) self.postMessage({ type: "generate:complete" });
}

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, data } = e.data;
  try {
    switch (type) {
      case "load":
        await loadModel();
        self.postMessage({ type: "load:complete" });
        break;
      case "generate":
        await generate(data.text, data.voice, data.speed);
        break;
      case "cancel":
        currentGeneration++;
        break;
      default:
        self.postMessage({ type: "error", data: { message: `Unknown message type: ${type}` } });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      data: { message: err instanceof Error ? err.message : String(err) },
    });
  }
});
