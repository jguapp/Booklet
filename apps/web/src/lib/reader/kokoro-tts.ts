/**
 * Open-source, zero-cost TTS: Kokoro (Apache-2.0, 82M params) running
 * entirely client-side via kokoro-js (built on @huggingface/transformers --
 * WASM; WebGPU is deliberately not used, see kokoro.worker.ts). No server,
 * no API key, no per-request cost -- the ~90MB quantized model downloads
 * once from Hugging Face's CDN on first use and is cached by the browser
 * (transformers.js's own model cache) after that.
 *
 * The actual model loading and generation happens in a dedicated Worker
 * (kokoro.worker.ts), not here -- this module is the main-thread client
 * that talks to it. See use-text-to-speech.ts for how this plugs into the
 * existing play/pause/resume/stop reader controls, falling back to the
 * native SpeechSynthesis engine when a voice isn't selected or this fails
 * to load (unsupported browser, network hiccup on first download).
 */
import { TextSplitterStream, type KokoroTTS } from "kokoro-js";

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

interface WorkerResponse {
  type: string;
  data?: unknown;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../../workers/kokoro.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

let loadPromise: Promise<void> | null = null;

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
export function loadKokoro(): Promise<void> {
  if (!loadPromise) {
    loadPromise = new Promise<void>((resolve, reject) => {
      const w = getWorker();
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "load:complete") {
          w.removeEventListener("message", onMessage);
          resolve();
        } else if (e.data.type === "error") {
          w.removeEventListener("message", onMessage);
          reject(new Error((e.data.data as { message: string }).message));
        }
      };
      w.addEventListener("message", onMessage);
      w.postMessage({ type: "load" });
    }).catch((err: unknown) => {
      loadPromise = null; // don't cache a permanent failure -- allow retry on the next play()
      throw err;
    });
  }
  return loadPromise;
}

/** A minimal async producer/consumer queue -- bridges the worker's
 * "message" events (push-based) to an async generator (pull-based) that
 * use-text-to-speech.ts can `for await` over, the same shape it already
 * consumed kokoro-js's own tts.stream() in. */
class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: ((result: IteratorResult<T>) => void)[] = [];
  private ended = false;
  private error: Error | null = null;

  push(item: T): void {
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    while (this.resolvers.length) this.resolvers.shift()!({ value: undefined, done: true });
  }

  fail(err: Error): void {
    this.error = err;
    this.end();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

/** Streams generated audio chunks from the worker as they're produced --
 * genuinely concurrently with whatever the caller does with each chunk
 * (e.g. play it), since generation now runs on its own thread instead of
 * the one also driving playback. See the module doc comment and
 * kokoro.worker.ts for why that distinction is the whole point of this
 * file existing. Abandoning the loop early (a `break`/`return` in the
 * caller's `for await`, e.g. use-text-to-speech.ts's stop()) sends the
 * worker a "cancel" so it stops generating further chunks for a playback
 * nobody wants anymore, instead of grinding through the rest of an
 * article's text for nothing. */
export function streamKokoro(text: string, options: { voice: KokoroVoiceId; speed: number }): AsyncGenerator<Blob> {
  const queue = new AsyncQueue<Blob>();
  const w = getWorker();

  const onMessage = (e: MessageEvent<WorkerResponse>) => {
    const { type, data } = e.data;
    if (type === "chunk") queue.push((data as { blob: Blob }).blob);
    else if (type === "generate:complete") queue.end();
    else if (type === "error") queue.fail(new Error((data as { message: string }).message));
  };
  w.addEventListener("message", onMessage);
  w.postMessage({ type: "generate", data: { text, voice: options.voice, speed: options.speed } });

  return (async function* () {
    try {
      while (true) {
        const { value, done } = await queue.next();
        if (done) return;
        yield value;
      }
    } finally {
      w.removeEventListener("message", onMessage);
      w.postMessage({ type: "cancel" }); // harmless no-op if generation already finished on its own
    }
  })();
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
// individual push() small). Used inside kokoro.worker.ts, not here -- kept
// in this shared module since it's a plain text utility, not anything
// worker-specific.
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
