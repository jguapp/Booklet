/**
 * #159, the part that can be answered without a GPU, a model download, or
 * the public internet.
 *
 *   pnpm --filter @booklet/api exec tsx scripts/analyze-readalong-drift.ts
 *
 * Read-along highlighting estimates each word's moment from its share of
 * the chunk's character count. The question is whether that estimate is bad
 * enough to justify forced alignment -- a second model inference per chunk,
 * on a pipeline already running at 1-2x realtime on CPU.
 *
 * Ground truth needs a real aligner over real generated audio, which needs
 * Hugging Face; see bench-readalong-alignment.ts for that half. This script
 * does the half that needs neither, by running a second, structurally
 * different timing model over the same text and reporting how far the two
 * disagree.
 *
 * The logic of that is one-directional and worth being explicit about,
 * because it is easy to over-read: two independent estimates agreeing
 * closely is decent evidence the cheap one is not badly wrong, since they
 * would have to be wrong in the same direction by the same amount. Two
 * estimates disagreeing proves only that at least one is wrong, not which.
 *
 * So this can rule the question *out* -- and that is the outcome worth
 * spending twenty seconds to check before spending a week on an aligner.
 *
 * The constants in the second model are its weakest part, so nothing here
 * quotes a single result: every configuration is swept and the conclusion
 * has to hold across all of them or it is not reported as a conclusion.
 */
import {
  DEFAULT_SPEECH_PARAMS,
  PERCEPTIBLE_DRIFT_MS,
  characterProportionalTimings,
  compareTimings,
  syllablePauseTimings,
  toSafeTextChunks,
  wordSpansOf,
  type SpeechParams,
} from "@booklet/shared";

/**
 * Real prose, not lorem ipsum, and deliberately varied in the dimension
 * that matters: how evenly punctuation and syllable weight are distributed.
 * A uniform paragraph of medium words is the case the character-
 * proportional model handles best, so testing only that would answer a
 * question nobody asked.
 */
const SAMPLES: { name: string; text: string }[] = [
  {
    name: "even prose, few marks",
    text:
      "The library had been built in the same decade as the bridge and shared its unfussy confidence in straight lines. " +
      "Readers came in the morning and stayed until the light went flat and the radiators began to tick. " +
      "Nobody had ever thought to put up a sign explaining any of this because nobody had ever needed one.",
  },
  {
    name: "heavy punctuation",
    text:
      "Wait — no, listen. The point isn't speed; it never was. It's attention, which is different, and rarer, and harder. " +
      "Ask anyone: do they read more now? Yes. Do they remember more? No. Well, then.",
  },
  {
    name: "long words, sparse marks",
    text:
      "Photosynthesis represents an extraordinarily sophisticated biochemical transformation whereby electromagnetic radiation " +
      "becomes chemical potential distributed throughout interconnected metabolic pathways operating simultaneously.",
  },
  {
    name: "short words, dense",
    text:
      "He got up. He went out. The sun was low and the road was wet and the air had that smell it gets. " +
      "He did not know where he was going yet but he knew he was not going back.",
  },
  {
    name: "dialogue",
    text:
      '"You read it?" she said. "All of it?" — "Most," he said. "The middle drags." ' +
      '"Everyone says that." "Everyone\'s right." She laughed, once, and did not look up.',
  },
];

/**
 * The sweep. If the verdict flips anywhere in here, it isn't a verdict.
 *
 * Only the pauses vary, because after the rescale in `syllablePauseTimings`
 * the model depends solely on the ratio of pause time to syllable time --
 * scaling all three parameters together is absorbed and changes nothing
 * (pinned by a test). So holding `secondsPerSyllable` at 0.2 and moving the
 * pauses across these ranges sweeps pause:syllable ratios from 0.25 to 4,
 * which spans anything defensible.
 */
const SWEEP: SpeechParams[] = [];
for (const comma of [0.05, 0.15, 0.3]) {
  for (const sentence of [0.15, 0.4, 0.8]) {
    SWEEP.push({ secondsPerSyllable: DEFAULT_SPEECH_PARAMS.secondsPerSyllable, commaPauseSeconds: comma, sentencePauseSeconds: sentence });
  }
}

/**
 * Kokoro on this pipeline runs near real time, and the audio for a chunk is
 * as long as it takes to say it. Deriving the assumed duration from syllable
 * count rather than fixing it keeps long chunks long, which matters because
 * absolute drift in milliseconds is what a reader perceives, and it grows
 * with chunk length.
 */
function assumedDurationSeconds(text: string): number {
  const syllables = wordSpansOf(text).reduce((n, s) => {
    const w = s.text.toLowerCase().replace(/[^a-z]/g, "");
    const groups = w.match(/[aeiouy]+/g);
    return n + Math.max(1, groups ? groups.length : 0);
  }, 0);
  return syllables * DEFAULT_SPEECH_PARAMS.secondsPerSyllable;
}

interface Row {
  sample: string;
  chunkChars: number;
  words: number;
  durationS: number;
  maxAbsMs: number;
  rmsMs: number;
}

const rows: Row[] = [];
let worstOverall = 0;
let worstConfig = "";

for (const params of SWEEP) {
  const label = `comma=${params.commaPauseSeconds}s sentence=${params.sentencePauseSeconds}s`;
  for (const sample of SAMPLES) {
    // The real chunker, so the lengths measured are the lengths that ship.
    for (const chunk of toSafeTextChunks(sample.text)) {
      const duration = assumedDurationSeconds(chunk);
      if (duration <= 0) continue;
      const cmp = compareTimings(
        characterProportionalTimings(chunk, duration),
        syllablePauseTimings(chunk, duration, params),
      );
      if (params === SWEEP[Math.floor(SWEEP.length / 2)]) {
        rows.push({
          sample: sample.name,
          chunkChars: chunk.length,
          words: cmp.wordCount,
          durationS: duration,
          maxAbsMs: cmp.maxAbsMs,
          rmsMs: cmp.rmsMs,
        });
      }
      if (cmp.maxAbsMs > worstOverall) {
        worstOverall = cmp.maxAbsMs;
        worstConfig = `${label}, "${sample.name}", ${chunk.length} chars`;
      }
    }
  }
}

console.log("\nRead-along timing: character-proportional vs syllable+pause");
console.log("(mid-sweep configuration shown per chunk; worst case is across the whole sweep)\n");
console.log(
  ["sample", "chars", "words", "audio s", "max ms", "rms ms"]
    .map((h, i) => (i === 0 ? h.padEnd(24) : h.padStart(9)))
    .join(""),
);
console.log("-".repeat(24 + 9 * 5));
for (const r of rows) {
  console.log(
    r.sample.padEnd(24) +
      String(r.chunkChars).padStart(9) +
      String(r.words).padStart(9) +
      r.durationS.toFixed(1).padStart(9) +
      r.maxAbsMs.toFixed(0).padStart(9) +
      r.rmsMs.toFixed(0).padStart(9),
  );
}

const midMax = Math.max(...rows.map((r) => r.maxAbsMs));
const midRms = Math.max(...rows.map((r) => r.rmsMs));

console.log(`\nMid-sweep:   worst per-word ${midMax.toFixed(0)}ms, worst RMS ${midRms.toFixed(0)}ms`);
console.log(`Full sweep:  worst per-word ${worstOverall.toFixed(0)}ms  (${worstConfig})`);
console.log(`Threshold:   ${PERCEPTIBLE_DRIFT_MS}ms, fixed in readalong-timing.ts before any of this was run\n`);

if (worstOverall < PERCEPTIBLE_DRIFT_MS) {
  console.log("VERDICT (provisional): the two models agree within the perceptibility threshold");
  console.log("across every configuration swept. Forced alignment has little room to improve");
  console.log("something a reader can notice. Confirm with real audio before closing #159.\n");
} else {
  console.log("VERDICT (provisional): the models disagree by more than the perceptibility");
  console.log("threshold. That does not show the shipped estimate is the wrong one -- only");
  console.log("that this cannot rule the question out. Ground truth is needed:");
  console.log("  pnpm --filter @booklet/api exec tsx scripts/bench-readalong-alignment.ts\n");
}
