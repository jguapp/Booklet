/**
 * #159, the half that needs ground truth.
 *
 *   pnpm --filter @booklet/api exec tsx scripts/bench-readalong-alignment.ts
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ THIS SCRIPT HAS NEVER BEEN EXECUTED.                                  │
 * │                                                                       │
 * │ It was written in a sandbox with no route to Hugging Face, so neither │
 * │ Kokoro's weights nor Whisper's could be fetched. It is a considered   │
 * │ design, not a verified one: expect to debug it on first run, and do   │
 * │ not treat any number it prints as trustworthy until it has been read  │
 * │ once by someone who watched it run.                                   │
 * │                                                                       │
 * │ Saying so here rather than discovering it later is the whole point.   │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * analyze-readalong-drift.ts establishes what can be known offline: the
 * shipped character-proportional estimate and an independent syllable+pause
 * model disagree by far more than the 100ms perceptibility threshold, across
 * every parameter setting swept. That rules nothing out. It says only that
 * at least one of the two is meaningfully wrong, and does not say which.
 *
 * This resolves it, by generating the audio the reader actually hears and
 * asking where the words really fall.
 *
 * ## Why Whisper word timestamps rather than a CTC forced aligner
 *
 * #159 proposed wav2vec2 CTC alignment. That is the more correct instrument:
 * forced alignment is *given* the transcript and only has to place it, so it
 * cannot disagree about what was said. But it also means implementing the
 * Viterbi pass over CTC logits by hand, since transformers.js exposes the
 * logits and not the alignment.
 *
 * Whisper with `return_timestamps: "word"` gets word times directly, from a
 * model already reachable through the exact `@huggingface/transformers` +
 * onnxruntime-node stack this app runs Kokoro on. Its weakness is that it is
 * recognition, not alignment: it can mis-transcribe, so its word sequence
 * may not match the input. That is handled below by aligning the two
 * sequences and measuring only where they agree.
 *
 * For this question that trade is fine. The measurement needed is "is the
 * shipped estimate off by tens of milliseconds or by hundreds" -- a decision
 * between two orders of magnitude. Whisper is comfortably good enough to
 * settle that, and if it comes back ambiguous (near the threshold, or with
 * poor transcript agreement), *that* is when the CTC implementation becomes
 * worth writing.
 */
import {
  PERCEPTIBLE_DRIFT_MS,
  characterProportionalTimings,
  compareTimings,
  toSafeTextChunks,
  wordSpansOf,
} from "@booklet/shared";
import { generateSpeechPooled, stopTtsPool } from "../src/services/tts-pool.js";

const VOICE = "af_heart";
const SPEED = 1;
const ASR_MODEL = "Xenova/whisper-base.en";

/** The same prose analyze-readalong-drift.ts uses, so the two are comparable. */
const SAMPLES: { name: string; text: string }[] = [
  {
    name: "even prose, few marks",
    text:
      "The library had been built in the same decade as the bridge and shared its unfussy confidence in straight lines. " +
      "Readers came in the morning and stayed until the light went flat and the radiators began to tick.",
  },
  {
    name: "heavy punctuation",
    text: "Wait — no, listen. The point isn't speed; it never was. It's attention, which is different, and rarer, and harder.",
  },
  {
    name: "long words, sparse marks",
    text:
      "Photosynthesis represents an extraordinarily sophisticated biochemical transformation whereby electromagnetic radiation " +
      "becomes chemical potential distributed throughout interconnected metabolic pathways.",
  },
  {
    name: "short words, dense",
    text: "He got up. He went out. The sun was low and the road was wet and the air had that smell it gets.",
  },
];

/** Strips punctuation and case so "listen." and "listen" compare equal. */
function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

/**
 * Longest-common-subsequence match between the words we asked for and the
 * words Whisper heard, so a single mis-transcription costs one word rather
 * than desynchronising everything after it.
 *
 * Returns index pairs into the two arrays.
 */
function alignSequences(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** 16-bit PCM WAV -> mono float32 at the sample rate Whisper wants (16kHz). */
function wavToFloat32Mono16k(wav: Buffer): Float32Array {
  // Minimal parse: this pipeline emits a canonical 44-byte-header PCM16 WAV
  // (see wav-pcm16.test.ts), so the fields are at fixed offsets.
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const dataSize = wav.readUInt32LE(40);
  const sampleCount = dataSize / 2 / channels;

  const mono = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += wav.readInt16LE(44 + (i * channels + c) * 2) / 32768;
    mono[i] = sum / channels;
  }
  if (sampleRate === 16000) return mono;

  // Linear resample. Crude, and adequate: a fractional-sample error is
  // microseconds against a threshold of 100 milliseconds.
  const ratio = 16000 / sampleRate;
  const out = new Float32Array(Math.floor(sampleCount * ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, sampleCount - 1);
    const frac = src - lo;
    out[i] = mono[lo]! * (1 - frac) + mono[hi]! * frac;
  }
  return out;
}

async function main(): Promise<void> {
  const { pipeline } = await import("@huggingface/transformers");
  console.log(`Loading ${ASR_MODEL} …`);
  const asr = await pipeline("automatic-speech-recognition", ASR_MODEL);

  const rows: { sample: string; chars: number; matched: number; of: number; maxAbsMs: number; rmsMs: number }[] = [];

  for (const sample of SAMPLES) {
    for (const chunk of toSafeTextChunks(sample.text)) {
      const wav = await generateSpeechPooled(chunk, VOICE, SPEED);
      const audio = wavToFloat32Mono16k(Buffer.from(wav));
      const durationSeconds = audio.length / 16000;

      const out = (await asr(audio, { return_timestamps: "word" })) as {
        chunks?: { text: string; timestamp: [number, number] }[];
      };
      const heard = out.chunks ?? [];
      if (heard.length === 0) {
        console.log(`  (no word timestamps returned for a ${chunk.length}-char chunk -- skipped)`);
        continue;
      }

      const wanted = wordSpansOf(chunk);
      const pairs = alignSequences(
        wanted.map((w) => normalizeWord(w.text)),
        heard.map((h) => normalizeWord(h.text)),
      );
      if (pairs.length < wanted.length * 0.6) {
        console.log(`  (only ${pairs.length}/${wanted.length} words matched -- transcript too poor, skipped)`);
        continue;
      }

      const estimated = characterProportionalTimings(chunk, durationSeconds);
      const cmp = compareTimings(
        pairs.map(([wi]) => estimated[wi]!),
        pairs.map(([, hi]) => heard[hi]!.timestamp[0]),
      );
      rows.push({
        sample: sample.name,
        chars: chunk.length,
        matched: pairs.length,
        of: wanted.length,
        maxAbsMs: cmp.maxAbsMs,
        rmsMs: cmp.rmsMs,
      });
    }
  }

  console.log("\nShipped estimate vs Whisper word timestamps (ground truth)\n");
  console.log(["sample", "chars", "matched", "max ms", "rms ms"].map((h, i) => (i === 0 ? h.padEnd(26) : h.padStart(9))).join(""));
  console.log("-".repeat(26 + 9 * 4));
  for (const r of rows) {
    console.log(
      r.sample.padEnd(26) +
        String(r.chars).padStart(9) +
        `${r.matched}/${r.of}`.padStart(9) +
        r.maxAbsMs.toFixed(0).padStart(9) +
        r.rmsMs.toFixed(0).padStart(9),
    );
  }

  if (rows.length === 0) {
    console.log("\nNo chunk produced a usable comparison. Investigate before drawing any conclusion.\n");
    return;
  }

  const worstMax = Math.max(...rows.map((r) => r.maxAbsMs));
  const worstRms = Math.max(...rows.map((r) => r.rmsMs));
  console.log(`\nWorst per-word ${worstMax.toFixed(0)}ms, worst RMS ${worstRms.toFixed(0)}ms`);
  console.log(`Threshold ${PERCEPTIBLE_DRIFT_MS}ms (fixed in readalong-timing.ts before any measurement)\n`);

  if (worstRms < PERCEPTIBLE_DRIFT_MS) {
    console.log("The shipped estimate is within the perceptibility threshold. Keep it, and do");
    console.log("not ship click-to-seek on top of it -- seeking is the feature that needs");
    console.log("accuracy the estimate does not have, even where the highlight looks fine.\n");
  } else {
    console.log("The shipped estimate drifts perceptibly. Forced alignment is justified. Put it");
    console.log("on the low-priority queue *after* audio is returned, never on the TTFA path,");
    console.log("cache the timings beside the audio, and bump the tts:pcm16:v1: key prefix --");
    console.log("the cache value shape changes.\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => stopTtsPool());
