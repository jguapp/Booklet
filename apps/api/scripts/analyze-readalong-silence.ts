/**
 * Separates two things bench-readalong-alignment.ts measured together (#159).
 *
 *   pnpm --filter @booklet/api exec tsx scripts/analyze-readalong-silence.ts
 *
 * That benchmark compared the shipped estimate against Whisper word times and
 * concluded forced alignment was justified. Reading its per-word output rather
 * than its summary shows the errors grow monotonically with word position --
 * 0ms, 130, 268, 425, 575, 770 across one chunk. That is the signature of a
 * systematic *scale* error, not of speech pacing unevenly.
 *
 * The cause is trailing silence. Kokoro's output ends with a stretch of
 * near-silence after the last word, and the shipped estimate maps the whole
 * chunk's characters linearly across the whole audio *duration*:
 *
 *     charPos = (currentTime / duration) * chunkText.length
 *
 * so every word is pushed later by the ratio of padded to spoken length. It
 * matters because it is real user-visible drift -- the player uses the same
 * duration -- but the fix for it is trimming a number, not a second model.
 *
 * This script quantifies both halves separately:
 *
 *   - padding:   how much of each clip is trailing silence
 *   - corrected: the drift that remains once the estimate is anchored to the
 *                spoken interval instead of the raw duration
 *
 * The residual is the honest input to #159's question. If it is under the
 * 100ms perceptibility threshold, forced alignment buys nothing and the fix
 * is to trim; if it is still over, alignment is genuinely justified and this
 * says by how much.
 */
import {
  PERCEPTIBLE_DRIFT_MS,
  characterProportionalTimings,
  toSafeTextChunks,
  wordSpansOf,
} from "@booklet/shared";
import { generateSpeechPooled, stopTtsPool } from "../src/services/tts-pool.js";

const VOICE = "af_heart";
const SPEED = 1;
const ASR_MODEL = "Xenova/whisper-base.en";

/** Same prose as the other two scripts, so all three are comparable. */
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
  { name: "short words, dense", text: "He got up. He went out. The sun was low and the road was wet and the air had that smell it gets." },
];

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function wavToFloat32Mono16k(wav: Buffer): Float32Array {
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

/**
 * Last sample above an amplitude floor, in seconds.
 *
 * Measured from the waveform rather than taken from Whisper, so the two are
 * independent: using Whisper's last word to both define the trim and score the
 * result would make the correction unfalsifiable.
 */
function speechEndSeconds(audio: Float32Array, rate = 16000, floor = 0.01): number {
  for (let i = audio.length - 1; i >= 0; i--) {
    if (Math.abs(audio[i]!) > floor) return (i + 1) / rate;
  }
  return audio.length / rate;
}

/** Longest common subsequence over normalized words, as index pairs. */
function alignSequences(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
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

function stats(deltasMs: number[]): { maxAbs: number; rms: number } {
  const maxAbs = Math.max(...deltasMs.map(Math.abs));
  const rms = Math.sqrt(deltasMs.reduce((s, d) => s + d * d, 0) / deltasMs.length);
  return { maxAbs: Math.round(maxAbs), rms: Math.round(rms) };
}

async function main(): Promise<void> {
  const { pipeline } = await import("@huggingface/transformers");
  console.log(`Loading ${ASR_MODEL} …`);
  const asr = await pipeline("automatic-speech-recognition", ASR_MODEL);

  const rows: {
    sample: string;
    chars: number;
    durationS: number;
    padMs: number;
    alignMs: number;
    audioBytes: number;
    timingBytes: number;
    raw: { maxAbs: number; rms: number };
    trimmed: { maxAbs: number; rms: number };
  }[] = [];

  for (const sample of SAMPLES) {
    for (const chunk of toSafeTextChunks(sample.text)) {
      const wav = Buffer.from(await generateSpeechPooled(chunk, VOICE, SPEED));
      const audio = wavToFloat32Mono16k(wav);
      const durationSeconds = audio.length / 16000;
      const spokenSeconds = speechEndSeconds(audio);

      // Wall-clock for the alignment pass itself, which is the cost #159 asks
      // to quantify: this is what a second inference per chunk would add.
      const alignStart = performance.now();
      const out = (await asr(audio, { return_timestamps: "word" })) as {
        chunks?: { text: string; timestamp: [number, number] }[];
      };
      const alignMs = Math.round(performance.now() - alignStart);
      const heard = out.chunks ?? [];
      if (heard.length === 0) continue;

      const wanted = wordSpansOf(chunk);
      const pairs = alignSequences(wanted.map((w) => normalizeWord(w.text)), heard.map((h) => normalizeWord(h.text)));
      if (pairs.length < wanted.length * 0.6) continue;

      // The shipped model, exactly as it runs today: characters spread across
      // the full padded duration.
      const raw = characterProportionalTimings(chunk, durationSeconds);
      // The same model, anchored to the spoken interval instead. This is the
      // whole proposed fix -- one number changed, no second inference.
      const trimmed = characterProportionalTimings(chunk, spokenSeconds);

      const truth = pairs.map(([, hi]) => heard[hi]!.timestamp[0]);
      const rawDeltas = pairs.map(([wi], k) => (raw[wi]! - truth[k]!) * 1000);
      const trimmedDeltas = pairs.map(([wi], k) => (trimmed[wi]! - truth[k]!) * 1000);

      rows.push({
        sample: sample.name,
        chars: chunk.length,
        durationS: durationSeconds,
        padMs: Math.round((durationSeconds - spokenSeconds) * 1000),
        alignMs,
        audioBytes: wav.length,
        // What would actually be cached beside the audio: one start time per
        // word. Float32 is ample -- 24kHz audio cannot resolve finer than
        // ~40us anyway, and the threshold here is 100ms.
        timingBytes: wanted.length * 4,
        raw: stats(rawDeltas),
        trimmed: stats(trimmedDeltas),
      });
    }
  }

  console.log("\nTrailing silence, and the drift it accounts for\n");
  const head = ["sample", "chars", "pad ms", "raw max", "raw rms", "trim max", "trim rms"];
  console.log(head.map((h, i) => (i === 0 ? h.padEnd(26) : h.padStart(9))).join(""));
  console.log("-".repeat(26 + 9 * 6));
  for (const r of rows) {
    console.log(
      r.sample.padEnd(26) +
        String(r.chars).padStart(9) +
        String(r.padMs).padStart(9) +
        String(r.raw.maxAbs).padStart(9) +
        String(r.raw.rms).padStart(9) +
        String(r.trimmed.maxAbs).padStart(9) +
        String(r.trimmed.rms).padStart(9),
    );
  }

  const worstRawRms = Math.max(...rows.map((r) => r.raw.rms));
  const worstTrimRms = Math.max(...rows.map((r) => r.trimmed.rms));
  const worstTrimMax = Math.max(...rows.map((r) => r.trimmed.maxAbs));
  const avgPad = Math.round(rows.reduce((s, r) => s + r.padMs, 0) / rows.length);

  const avgAlign = Math.round(rows.reduce((s, r) => s + r.alignMs, 0) / rows.length);
  const worstAlign = Math.max(...rows.map((r) => r.alignMs));
  const totalAudio = rows.reduce((s, r) => s + r.audioBytes, 0);
  const totalTimings = rows.reduce((s, r) => s + r.timingBytes, 0);

  console.log(`\nAlignment cost: ${avgAlign}ms per chunk mean, ${worstAlign}ms worst`);
  console.log(
    `Storage cost:   ${totalTimings}B of timings against ${Math.round(totalAudio / 1024)}KB of audio ` +
      `(${((totalTimings / totalAudio) * 100).toFixed(3)}% overhead)`,
  );
  console.log(`\nMean trailing silence: ${avgPad}ms`);
  console.log(`Worst RMS: ${worstRawRms}ms as shipped -> ${worstTrimRms}ms anchored to speech`);
  console.log(`Threshold: ${PERCEPTIBLE_DRIFT_MS}ms`);
  console.log(
    worstTrimMax <= PERCEPTIBLE_DRIFT_MS
      ? "\nTrimming alone brings drift under the threshold. Forced alignment is not justified."
      : `\nTrimming removes most of the drift but ${worstTrimMax}ms remains at worst. ` +
          "Trim first -- it is one number and no extra inference -- then re-judge alignment against the residual.",
  );

  await stopTtsPool();
}

main().catch(async (err) => {
  console.error(err);
  await stopTtsPool().catch(() => undefined);
  process.exit(1);
});
