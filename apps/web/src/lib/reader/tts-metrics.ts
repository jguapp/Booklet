/**
 * Time-to-first-audio instrumentation for read-aloud.
 *
 * This exists because TTFA was, until now, entirely unmeasurable from the
 * client: the only signal anything was happening was a spinner, so "is it
 * faster?" could only be answered by feel. Every change made for latency
 * needs a number attached to it, and the number that matters is the one
 * measured in a real browser -- the server-side benchmark
 * (apps/api/scripts/bench-tts-ttfa.ts) never sees CORS preflights, transfer
 * time, or audio-element decode.
 *
 * Deliberately near-zero cost when nobody's looking: marks go to the
 * standard User Timing API (so they show up in a devtools performance
 * profile for free) and the derived summary is only logged when explicitly
 * switched on, since a console line on every play is noise for everyone
 * else. Enable with:
 *
 *   localStorage.setItem("booklet:tts-debug", "1")
 *
 * The last few runs are also kept on `window.__ttsMetrics` so a number can
 * be read back after the fact without having had logging on beforehand.
 */

const DEBUG_KEY = "booklet:tts-debug";
const RING_SIZE = 20;

export interface TtfaSample {
  /** Whether the first chunk was already in hand when play was pressed --
   * i.e. whether speculative warming actually paid off for this run. */
  prewarmHit: boolean;
  /** Click to audible sound. The headline number. */
  ttfaMs: number;
  /** Click to the first chunk's bytes being available. */
  blobMs: number;
  /** Blob in hand to audio actually playing: object URL, element setup, decode. */
  decodeMs: number;
  bytes: number;
  at: number;
}

declare global {
  interface Window {
    __ttsMetrics?: TtfaSample[];
  }
}

function debugEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    // Private browsing / storage disabled -- never let telemetry throw into
    // the playback path.
    return false;
  }
}

function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    /* User Timing unavailable -- not worth caring about. */
  }
}

/** A run in progress. Reset on every play so a stale click can't be paired
 * with a later chunk. */
let pending: { clickedAt: number; blobAt: number | null; prewarmHit: boolean } | null = null;

export function markPlayClicked(prewarmHit: boolean): void {
  mark("tts:play-clicked");
  pending = { clickedAt: performance.now(), blobAt: null, prewarmHit };
}

export function markFirstChunkReady(): void {
  if (!pending) return;
  mark("tts:chunk0-blob-ready");
  pending.blobAt = performance.now();
}

/** Called once the first chunk is genuinely audible -- after play() resolves,
 * not merely when it was requested. */
export function markFirstAudio(bytes: number): void {
  if (!pending || pending.blobAt === null) {
    pending = null;
    return;
  }
  mark("tts:chunk0-playing");

  const now = performance.now();
  const sample: TtfaSample = {
    prewarmHit: pending.prewarmHit,
    ttfaMs: Math.round(now - pending.clickedAt),
    blobMs: Math.round(pending.blobAt - pending.clickedAt),
    decodeMs: Math.round(now - pending.blobAt),
    bytes,
    at: Date.now(),
  };
  pending = null;

  if (typeof window !== "undefined") {
    const ring = (window.__ttsMetrics ??= []);
    ring.push(sample);
    if (ring.length > RING_SIZE) ring.shift();
  }

  if (debugEnabled()) {
    console.debug(
      `[tts] TTFA ${sample.ttfaMs}ms (fetch ${sample.blobMs}ms + decode ${sample.decodeMs}ms), ` +
        `prewarm ${sample.prewarmHit ? "hit" : "miss"}, ${(sample.bytes / 1024).toFixed(0)}KB`,
    );
  }
}

/** A run that ended before audio played (stopped, or a failed chunk) --
 * clears the pending sample so it can't attach itself to the next play. */
export function abandonTtfaSample(): void {
  pending = null;
}
