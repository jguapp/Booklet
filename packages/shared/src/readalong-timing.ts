/**
 * Read-along timing models, and the machinery to measure how far apart they
 * are (#159).
 *
 * The shipped read-along highlight is a *character-proportional* estimate:
 * tts-player-provider.tsx computes
 *
 *     charPos = (audioEl.currentTime / audioEl.duration) * chunkText.length
 *
 * and highlights the last word whose span starts before charPos. That maps
 * character position to time linearly, which assumes speech is paced evenly
 * per character. It isn't. "through" and "thought" are seven characters and
 * one syllable; "a" is one character and one syllable; a comma adds time no
 * character accounts for at all.
 *
 * The question #159 asks is whether that matters enough to pay for forced
 * alignment -- a second model inference per chunk, on a pipeline that
 * already runs at 1-2x realtime on CPU. Answering it properly needs ground
 * truth from a real aligner over real generated audio.
 *
 * This module is what can be established *without* that, and it is
 * deliberately not dressed up as more:
 *
 *   - `characterProportionalTimings` reproduces exactly what ships today.
 *   - `syllablePauseTimings` is a second, structurally different estimate
 *     built from syllable counts and punctuation pauses.
 *   - `compareTimings` reports how far apart they are, per word.
 *
 * The output is a *disagreement*, not an error. Neither model is ground
 * truth. What makes it useful anyway is the direction of the inference: if
 * two independent estimates of the same quantity agree closely, then the
 * cheap one is unlikely to be badly wrong, and forced alignment has little
 * room to help. Large disagreement does not prove the cheap one is wrong,
 * but it is the only condition under which the expensive fix could be worth
 * it -- so this cheaply rules the question *out*, and cannot rule it in.
 *
 * Every constant below is a parameter with a plausible range rather than a
 * fixed number, because the constants are the weakest part of the second
 * model and a conclusion that only holds at one setting of them is not a
 * conclusion. See `DEFAULT_SPEECH_PARAMS` and the sweep in
 * scripts/analyze-readalong-drift.ts.
 */

export interface WordSpan {
  /** Character offset of the word's first character within the chunk. */
  start: number;
  /** Character offset one past the word's last character. */
  end: number;
  text: string;
}

/**
 * Splits a chunk into word spans over its own character offsets.
 *
 * Mirrors what the player does, and the offsets are into the *original*
 * string including the whitespace between words -- the gaps are what give
 * the estimate somewhere to put inter-word time, so collapsing them would
 * change the thing being measured.
 */
export function wordSpansOf(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return spans;
}

/**
 * Word start times, in seconds, exactly as the shipped player derives them.
 *
 * The player works backwards (time -> character -> word); this works
 * forwards (word -> character -> time) so the two models can be compared
 * word by word. They are the same linear map, read in opposite directions.
 */
export function characterProportionalTimings(text: string, durationSeconds: number): number[] {
  const spans = wordSpansOf(text);
  const chars = text.length;
  if (chars === 0) return spans.map(() => 0);
  return spans.map((s) => (s.start / chars) * durationSeconds);
}

export interface SpeechParams {
  /** Seconds of voiced audio per syllable. */
  secondsPerSyllable: number;
  /** Extra seconds after a comma, semicolon, colon or dash. */
  commaPauseSeconds: number;
  /** Extra seconds after a sentence-ending mark. */
  sentencePauseSeconds: number;
}

/**
 * Mid-range values. These are the model's weak point and are treated as
 * such: nothing downstream may depend on the exact figures, and the
 * analysis script sweeps a range around them rather than quoting one
 * result.
 *
 * ~0.2s/syllable puts a typical sentence near the commonly-cited 150-160
 * words-per-minute conversational range at roughly 1.5 syllables per word.
 * The pause values are ordered (sentence > comma > nothing) and of the
 * right magnitude; their precise size is exactly what the sweep exists to
 * make irrelevant to the conclusion.
 */
export const DEFAULT_SPEECH_PARAMS: SpeechParams = {
  secondsPerSyllable: 0.2,
  commaPauseSeconds: 0.15,
  sentencePauseSeconds: 0.4,
};

/**
 * Vowel-group syllable count.
 *
 * Deliberately the crude heuristic rather than a dictionary lookup. A real
 * pronouncing dictionary (CMUdict) would be more accurate per word and
 * would also be a multi-megabyte dependency shipped into a browser bundle
 * to answer a question that is only being asked to decide whether to do
 * something else entirely. The heuristic is wrong on a minority of words
 * in both directions, which is acceptable for a chunk-level aggregate and
 * would not be for per-word display.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 0;
  // Silent terminal "e" ("time" is one syllable, not two) -- but not when
  // it is the only vowel group, or "the" becomes zero.
  if (w.endsWith("e") && !w.endsWith("le") && n > 1) n -= 1;
  return Math.max(1, n);
}

/**
 * Word start times under a syllable-plus-pause model, scaled so the chunk
 * finishes at exactly `durationSeconds`.
 *
 * The rescale is what makes this comparable to the character-proportional
 * model at all: both are then estimates of *the same* known-length audio, so
 * any difference between them is a difference in pacing rather than a
 * difference in assumed speech rate.
 *
 * What survives the rescale is the *ratio* of pause time to syllable time.
 * Scaling all three parameters together changes nothing; changing a pause
 * relative to `secondsPerSyllable` is the only thing that moves the result.
 * That is why the sweep in analyze-readalong-drift.ts varies the pauses
 * against a fixed syllable duration -- it is sweeping that ratio, and the
 * one free parameter it appears to hold constant is not free.
 */
export function syllablePauseTimings(
  text: string,
  durationSeconds: number,
  params: SpeechParams = DEFAULT_SPEECH_PARAMS,
): number[] {
  const spans = wordSpansOf(text);
  if (spans.length === 0) return [];

  const starts: number[] = [];
  let t = 0;
  for (const span of spans) {
    starts.push(t);
    t += countSyllables(span.text) * params.secondsPerSyllable;
    // The punctuation that follows a word is attached to it by \S+, so the
    // pause is charged after that word rather than before the next one.
    if (/[.!?]["')\]]?$/.test(span.text)) t += params.sentencePauseSeconds;
    else if (/[,;:—–-]$/.test(span.text)) t += params.commaPauseSeconds;
  }

  const modelled = t;
  if (modelled <= 0) return starts.map(() => 0);
  const scale = durationSeconds / modelled;
  return starts.map((s) => s * scale);
}

export interface TimingComparison {
  wordCount: number;
  /** Largest absolute per-word disagreement, in milliseconds. */
  maxAbsMs: number;
  /** Root-mean-square disagreement across words, in milliseconds. */
  rmsMs: number;
  /** Signed mean, which shows whether one model systematically leads. */
  meanSignedMs: number;
}

export function compareTimings(a: number[], b: number[]): TimingComparison {
  const n = Math.min(a.length, b.length);
  if (n === 0) return { wordCount: 0, maxAbsMs: 0, rmsMs: 0, meanSignedMs: 0 };
  let maxAbs = 0;
  let sumSq = 0;
  let sumSigned = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i]! - b[i]!) * 1000;
    maxAbs = Math.max(maxAbs, Math.abs(d));
    sumSq += d * d;
    sumSigned += d;
  }
  return {
    wordCount: n,
    maxAbsMs: maxAbs,
    rmsMs: Math.sqrt(sumSq / n),
    meanSignedMs: sumSigned / n,
  };
}

/**
 * The threshold the recommendation is measured against, fixed here before
 * any numbers were produced so the decision cannot be quietly fitted to
 * whatever came out.
 *
 * 100ms is the figure named in #159, and it is the right order of
 * magnitude: audio-visual synchrony research consistently finds viewers
 * tolerate visual-lags-audio offsets of roughly this size before noticing.
 * A karaoke-style highlight is a more forgiving case than lip sync, so if
 * disagreement sits under 100ms the estimate is comfortably adequate and
 * forced alignment buys nothing a reader can perceive.
 */
export const PERCEPTIBLE_DRIFT_MS = 100;
