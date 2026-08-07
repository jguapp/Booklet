"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { pickBestVoice } from "./tts-voice";
import { isKokoroVoice, generateKokoroChunk, toSafeTextChunks, warmKokoroChunks } from "./kokoro-tts";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { updateArticleListeningPosition } from "@/lib/data/articles";
import { getDeviceId } from "./device-id";
import { abandonTtfaSample, markFirstAudio, markFirstChunkReady, markPlayClicked } from "./tts-metrics";

export type TtsStatus = "idle" | "loading" | "playing" | "paused";

interface TtsPlayerContextValue {
  status: TtsStatus;
  supported: boolean;
  /** Which article is currently loaded into the player -- null when idle.
   * Lets the persistent player bar (and the reader page, to show its own
   * "currently reading" state) know what's playing without re-deriving it
   * from status alone. */
  articleId: string | null;
  articleTitle: string | null;
  /** The exact text of the chunk currently playing/loading, and its index
   * -- for the reader's read-along highlight + auto-scroll. null when
   * nothing is playing, or while playing through the native SpeechSynthesis
   * voice (that engine has no chunk boundaries to report -- it speaks the
   * whole text in one browser-internal call). */
  currentChunkText: string | null;
  currentChunkIndex: number;
  totalChunks: number;
  /** Character offsets of the word currently being spoken, relative to the
   * start of currentChunkText -- estimated from audio playback position
   * (Kokoro doesn't emit real per-word timestamps), see playKokoro's own
   * comment. null whenever currentChunkText is, plus briefly at the very
   * start of each chunk before the first timeupdate fires. */
  currentWordRange: { start: number; end: number } | null;
  /** `startFraction` resumes from a stored listening position (#152) -- 0-1
   * over the article's text, rounded down to the chunk containing it. Ignored
   * by the native SpeechSynthesis voice, which has no chunks to start from. */
  play: (articleId: string, articleTitle: string, text: string, startFraction?: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Speculatively starts generating just the article's first chunk before
   * the user has pressed play at all -- see its own comment below for why. */
  prewarmFirstChunk: (articleId: string, text: string) => void;
}

const TtsPlayerContext = createContext<TtsPlayerContextValue | null>(null);

/**
 * How many chunks past the first to have the server generate into its cache
 * when an article is opened (see prewarmFirstChunk).
 *
 * This used to be justified by "the pool runs three workers, so all three
 * finish in roughly the wall-clock time of one" -- which turned out to be
 * false on a small host, where three concurrent generations measured 2.86x a
 * single one rather than ~1x (#162). Warming was not free; it was competing.
 *
 * Two is still the right number, but for a different reason: speculative
 * work goes on the pool's low-priority queue tier, which is only ever
 * drained when nothing is actually waiting. That makes warming safe even
 * when the pool is effectively serial -- it can consume idle capacity and
 * nothing else -- so the bound is about how much speculative work is worth
 * doing, not about how much the pool can absorb for free.
 *
 * These cover the window between "chunk one finishes playing" and "the play
 * loop's own prefetch has caught up" -- without them a listener gets a fast
 * start followed by a pause, which reads as worse than a uniformly slower
 * start.
 */
const PREWARM_SERVER_CHUNKS = 2;

/**
 * How often the listening position is written (#152).
 *
 * Matches reader-view.tsx's PROGRESS_SAVE_INTERVAL_MS deliberately -- this is
 * the listening sibling of that flush and there's no reason for the two to
 * disagree. What it must NOT be is per-`timeupdate`: that fires several times
 * a second per chunk, and a request each would cost far more than the feature
 * is worth. The position is accumulated in a ref on every tick (free) and only
 * ever leaves the tab on this timer, on tab-hide, and on stop.
 */
const LISTENING_SAVE_INTERVAL_MS = 10_000;

/** Below this, a position isn't worth writing or resuming from -- it rounds to
 * "you just started", and offering to resume someone to the first few seconds
 * of an article is noise rather than help. */
const MIN_LISTENING_FRACTION = 0.01;

/** Non-whitespace runs in `text`, as character-offset spans -- the units
 * playKokoro's timing estimate assigns playback time to. */
function wordSpansOf(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Global, app-shell-level TTS playback -- mounted once in the root layout
 * (not per-reader-page) specifically so playback survives navigating away
 * from the article being read, the way a real audio player would (Spotify,
 * Readwise's own "continue listening" bar). The old per-page useTextToSpeech
 * hook owned its own local state and got torn down the instant the reader
 * page unmounted; this owns the same state instead, at a point in the tree
 * that never unmounts on route changes. See tts-player-bar.tsx for the
 * persistent UI this drives, and reader-view.tsx for how the reader page
 * calls into this instead of managing its own playback.
 *
 * Generation is server-side now (kokoro-tts.ts's generateKokoroChunk, see
 * its own doc comment for why) -- chunks are fetched one at a time, with
 * the next chunk's fetch kicked off as soon as the current one's fetch
 * resolves rather than waiting for its playback to finish. Unlike the old
 * WASM-in-a-Worker approach, a network request doesn't compete with
 * anything for a thread, so this pipelining is just a plain concurrent
 * fetch -- no Worker needed to make it safe.
 */
export function TtsPlayerProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [articleId, setArticleId] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState<string | null>(null);
  const [currentChunkText, setCurrentChunkText] = useState<string | null>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentWordRange, setCurrentWordRange] = useState<{ start: number; end: number } | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const supported = typeof window !== "undefined";
  const { reader } = useDevicePrefs();
  // Surfaced via a toast rather than the player bar: the bar unmounts as
  // soon as status goes back to "idle" (see tts-player-bar.tsx's early
  // return), which is exactly what a failed chunk does -- so an error
  // rendered there would disappear in the same frame it appeared.
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const readerRef = useRef(reader);
  // Synced via effect, not written during render (React refs are only safe
  // to read/write outside of render -- effects, event handlers, etc.) --
  // read fresh inside the play loop below without retriggering it on every
  // rate/voice/volume change.
  useEffect(() => {
    readerRef.current = reader;
  }, [reader]);

  /**
   * Writes the accumulated listening position, if it has actually moved since
   * the last write (#152).
   *
   * Never throws and never awaits into the playback path: a failed position
   * write means the user resumes from a slightly older point, which is not
   * worth interrupting playback or showing an error for.
   */
  const flushListeningPosition = useCallback((reset = false) => {
    const id = listeningArticleIdRef.current;
    const fraction = listeningFractionRef.current;
    // Clearing lives in here rather than at the call site: these refs are
    // captured by this callback, and the React Compiler's immutability rule
    // (correctly) rejects mutating them again after calling it. Doing both in
    // one place also makes it impossible to clear without flushing first.
    const clear = () => {
      if (!reset) return;
      listeningArticleIdRef.current = null;
      listeningFractionRef.current = null;
      lastFlushedFractionRef.current = null;
    };
    if (!id || fraction === null) return clear();
    // Below the floor this is indistinguishable from "just started", and
    // writing it would make every abandoned first-chunk play produce a resume
    // offer on the user's other devices.
    if (fraction < MIN_LISTENING_FRACTION) return clear();
    // A paused player fires no timeupdate, so the timer would otherwise
    // rewrite the identical value every interval, forever.
    if (lastFlushedFractionRef.current === fraction) return clear();
    lastFlushedFractionRef.current = fraction;
    void updateArticleListeningPosition(id, fraction, getDeviceId(), isAuthenticated).catch(() => undefined);
    clear();
  }, [isAuthenticated]);

  // Same triggers as reader-view.tsx's progress flush, and for the same
  // reasons: the interval covers ordinary listening, visibilitychange covers
  // backgrounding the tab (which on mobile is what closing the app looks
  // like), and the unmount flush covers the rest. Unlike that one, this lives
  // in the provider rather than the reader page -- playback deliberately
  // outlives the reader route (see this file's header), so a flush owned by
  // the page would stop recording the moment the user navigated away while
  // still listening.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flushListeningPosition();
    }
    const interval = setInterval(flushListeningPosition, LISTENING_SAVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushListeningPosition();
    };
  }, [flushListeningPosition]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  // Listening position (#152). Refs, not state: this updates on every
  // `timeupdate` (several times a second) and nothing renders from it -- as
  // state it would re-render the whole app shell on each tick for no visible
  // change. The article id is tracked alongside the fraction so a flush that
  // lands after the user has switched articles writes to the right row.
  const listeningFractionRef = useRef<number | null>(null);
  const listeningArticleIdRef = useRef<string | null>(null);
  const lastFlushedFractionRef = useRef<number | null>(null);
  const resolveCurrentChunkRef = useRef<(() => void) | null>(null);

  // Real, measured first-chunk generation time is the whole "TTS feels slow
  // to start" complaint -- several seconds on CPU, unavoidable without
  // dedicated inference hardware (see tts-service.ts's own doc comment).
  // What *is* avoidable: making the user's own play click be what starts
  // that clock. The article's text and TTS voice are both known well
  // before anyone presses play -- as soon as the reader page has them (see
  // reader-view.tsx), this fires the exact same first-chunk request
  // playKokoro would make anyway, just several seconds earlier. play()
  // below reuses it instead of firing a duplicate if it's still the right
  // one by the time the user actually clicks; if they never click, it's
  // one wasted request, not a growing cost.
  const prewarmedRef = useRef<{
    articleId: string;
    /** The full article text this warm was derived from. Held so the
     * identity check can run *before* chunking rather than after -- the
     * reader re-fires this effect on any article mutation, and chunking a
     * whole article only to discover nothing changed was the expensive half
     * of that. */
    sourceText: string;
    chunkText: string;
    voice: string;
    rate: number;
    promise: Promise<Blob>;
    controller: AbortController;
  } | null>(null);

  // Whichever AbortController currently governs in-flight /api/tts
  // requests for the active generation -- set by playKokoro (a fresh one,
  // or inherited from a matching prewarm -- see there), reset to null once
  // stop() actually aborts it. Stopping used to only stop *consuming*
  // results client-side while the underlying fetches (and the server-side
  // generation behind them) kept running to completion regardless, tying
  // up pool workers for audio nothing would ever play -- confirmed by hand
  // this is a real, measurable contributor to "starting the same article
  // over again is slower than the first time": the second play's own
  // requests were queuing behind the first play's still-running, already-
  // abandoned ones.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!supported || !("speechSynthesis" in window)) return;
    function refreshVoice() {
      voiceRef.current = pickBestVoice(window.speechSynthesis.getVoices(), document.documentElement.lang || "en");
    }
    refreshVoice();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoice);
  }, [supported]);

  // Live volume changes apply to whatever's already playing, not just the
  // next chunk -- dragging the player bar's volume slider should be felt
  // immediately, the way it is in every other audio player.
  useEffect(() => {
    if (audioElRef.current) audioElRef.current.volume = reader.ttsVolume;
  }, [reader.ttsVolume]);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const prewarmFirstChunk = useCallback(
    (articleId: string, text: string) => {
      // Note this is inert whenever the selected voice is the device's own
      // SpeechSynthesis ("system", the default) -- correctly so: that path
      // needs no network round trip and no generation, so its time to first
      // audio is already effectively zero and there is nothing to warm.
      if (!supported || !isKokoroVoice(reader.ttsVoice) || !text.trim()) return;

      const existing = prewarmedRef.current;
      // Reader-view calls this reactively on every relevant render, most of
      // which change nothing that actually matters here -- skip re-issuing
      // an identical request rather than firing a new one (and abandoning
      // the still-in-flight old one) every time.
      //
      // Checked against the *source* text, before chunking, precisely so the
      // common no-op case costs nothing: this used to chunk the entire
      // article first and only then discover the result was identical.
      if (
        existing &&
        existing.articleId === articleId &&
        existing.sourceText === text &&
        existing.voice === reader.ttsVoice &&
        existing.rate === reader.ttsRate
      ) {
        return;
      }

      const chunks = toSafeTextChunks(text);
      const chunkText = chunks[0];
      if (!chunkText) return;
      // Supersede, don't just overwrite -- a previous prewarm (a different
      // article, or the same article before its text/voice finished
      // settling) is no longer needed once this one exists, so cancel it
      // rather than leaving it to run to completion for nothing.
      existing?.controller.abort();
      const controller = new AbortController();
      const promise = generateKokoroChunk(chunkText, reader.ttsVoice, reader.ttsRate, controller.signal);
      // A failed prewarm (network hiccup, the user closing the tab before
      // it resolves) shouldn't surface as an unhandled rejection just
      // because nothing ever consumed it -- attaching this no-op catch
      // marks the promise as handled without changing what the *original*
      // promise resolves/rejects to for whoever does still await it below.
      promise.catch(() => {});

      // The chunks *after* the first are warmed on the server instead of
      // being fetched here. They only need to be cache hits by the time
      // playback reaches them -- roughly a chunk's worth of audio later --
      // so downloading them now would just move bandwidth earlier for no
      // latency benefit, and waste it entirely for a reader who opens an
      // article and never presses play.
      //
      // Bounded at two -- see PREWARM_SERVER_CHUNKS for why that bound is
      // about how much speculation is worth doing rather than, as it once
      // claimed, about the pool absorbing three generations for free.
      warmKokoroChunks(chunks.slice(1, 1 + PREWARM_SERVER_CHUNKS), reader.ttsVoice, reader.ttsRate, controller.signal);

      prewarmedRef.current = {
        articleId,
        sourceText: text,
        chunkText,
        voice: reader.ttsVoice,
        rate: reader.ttsRate,
        promise,
        controller,
      };
    },
    [supported, reader.ttsVoice, reader.ttsRate],
  );

  const stop = useCallback(() => {
    // Before anything is torn down -- stopping is the single most likely
    // moment for the position to matter, and the refs it reads are cleared
    // below.
    flushListeningPosition(true);
    generationRef.current++; // abandon any in-flight chunk loop
    // Safe to do here even though play() calls stop() first: play()'s own
    // mark is recorded afterwards, in playKokoro.
    abandonTtfaSample();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (supported && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    audioElRef.current?.pause();
    audioElRef.current = null;
    resolveCurrentChunkRef.current?.();
    resolveCurrentChunkRef.current = null;
    revokeObjectUrl();
    setStatus("idle");
    setArticleId(null);
    setArticleTitle(null);
    setCurrentChunkText(null);
    setCurrentChunkIndex(0);
    setTotalChunks(0);
    setCurrentWordRange(null);
  }, [supported, revokeObjectUrl, flushListeningPosition]);

  const playNative = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = readerRef.current.ttsRate;
    utterance.volume = readerRef.current.ttsVolume;
    utterance.onend = () => {
      setStatus("idle");
      setArticleId(null);
      setArticleTitle(null);
    };
    utterance.onerror = () => setStatus("idle");
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }, []);

  const playKokoro = useCallback(
    async (articleId: string, text: string, startFraction = 0) => {
      const myGeneration = ++generationRef.current;
      setStatus("loading");

      const chunks = toSafeTextChunks(text);
      setTotalChunks(chunks.length);

      // Resume (#152). The stored position is a fraction of the article, so
      // it maps onto whatever chunking is in force *now* -- which is the whole
      // reason it isn't stored as an index. Rounding down means resuming at
      // the start of the chunk containing the position rather than mid-chunk:
      // chunk audio is generated as one utterance and can't be seeked into
      // meaningfully, and re-hearing a sentence is a much better failure than
      // skipping one. Clamped so a corrupt or out-of-range value can only ever
      // cost a restart from the beginning.
      const startIndex =
        startFraction > 0 ? Math.min(chunks.length - 1, Math.max(0, Math.floor(startFraction * chunks.length))) : 0;

      // Sliding-window prefetch, not just one chunk ahead: the server runs
      // a small pool of real concurrent generation processes now (see
      // apps/api's tts-pool.ts), so keeping several requests in flight at
      // once is what actually uses that concurrency -- one-ahead prefetch
      // just meant this client was never the bottleneck, but a *single*
      // server process still was.
      //
      // The window only ever *advances* once per loop iteration below, and
      // each iteration only starts once the *previous* chunk's audio has
      // fully finished playing -- so the window's real-world lead time over
      // the currently playing chunk is bounded by how long nearby chunks
      // take to *play back*, not by how much pool capacity is actually
      // free. Measured by hand with real server-side dispatch/response
      // timestamps: two short chunks (66-67 chars, a few seconds of audio
      // each) played back quickly enough that a ~190-char chunk right after
      // them -- needing ~15s to generate -- only got ~9s of head start
      // before it was needed, a ~6s shortfall that showed up as a real,
      // audible pause, even though the pool had free workers the whole
      // time. A depth of 3 (matching pool size) has no slack for that kind
      // of variance; widening it to 6 means the very first burst of
      // requests (fired before any playback has happened at all, so
      // nothing is gating them yet) already covers several chunks past the
      // typical trouble spot, and every later step inherits the same wider
      // buffer. Doesn't meaningfully change the sustained request rate over
      // a long article (still one request per chunk, same total count) --
      // only front-loads a few more of them, which is what actually fixes
      // this.
      const PREFETCH_DEPTH = 6;
      const inFlight = new Map<number, Promise<Blob>>();
      // Cursor-based, not a `!inFlight.has(i)` rescan from 0: each consumed
      // chunk is deleted from `inFlight` right after it's awaited below, so
      // a rescan from 0 would see it as "never requested" and re-fire a
      // brand-new generation for audio that already played and will never
      // be used again -- wasting real pool worker slots on every single
      // subsequent transition, and worse the further into the article you
      // get. A monotonic cursor guarantees each index is only ever
      // requested once, no matter how many times this is called.
      let nextToPrefetch = startIndex;

      // Reuse prewarmFirstChunk's head start if it's still the right one --
      // same article, same first chunk's text, same voice/rate -- instead
      // of firing a redundant duplicate request for index 0 and discarding
      // however many seconds of generation the prewarm already has behind
      // it. One-shot: consumed here (matched or not, still cleared) so a
      // later play() call for a different article can't accidentally pick
      // up a stale one.
      const warm = prewarmedRef.current;
      prewarmedRef.current = null;
      let controller: AbortController;
      if (
        warm &&
        // A resume doesn't start at chunk 0, so the prewarmed chunk 0 is audio
        // this playthrough will never reach -- reusing it would start the
        // article from the beginning despite the user having asked to resume.
        startIndex === 0 &&
        warm.articleId === articleId &&
        warm.chunkText === chunks[0] &&
        warm.voice === readerRef.current.ttsVoice &&
        warm.rate === readerRef.current.ttsRate
      ) {
        // That request IS this generation's chunk 0 now -- keep sharing
        // its controller so stopping mid-playback can still reach it,
        // instead of leaving it under a controller nothing else knows
        // about anymore.
        controller = warm.controller;
        inFlight.set(0, warm.promise);
        nextToPrefetch = 1;
        markPlayClicked(true);
      } else {
        markPlayClicked(false);
        warm?.controller.abort(); // stale prewarm for a different article/chunk/voice -- not needed
        controller = new AbortController();
      }
      abortControllerRef.current = controller;

      const ensurePrefetched = (uptoIndexInclusive: number) => {
        while (nextToPrefetch <= uptoIndexInclusive && nextToPrefetch < chunks.length) {
          inFlight.set(
            nextToPrefetch,
            generateKokoroChunk(chunks[nextToPrefetch], readerRef.current.ttsVoice, readerRef.current.ttsRate, controller.signal),
          );
          nextToPrefetch++;
        }
      };

      let firstChunkStarted = false;
      try {
        for (let i = startIndex; i < chunks.length; i++) {
          if (generationRef.current !== myGeneration) return;
          ensurePrefetched(i + PREFETCH_DEPTH - 1);

          let blob: Blob;
          try {
            blob = await inFlight.get(i)!;
          } catch (err) {
            if (generationRef.current !== myGeneration) return;
            // An AbortError here is the user pressing stop (or a supersede)
            // -- expected, and stop() has already reset everything. Anything
            // else is a real failure, and this used to be indistinguishable:
            // both went silently to "idle", so a rate-limited or failing
            // server just made read-aloud quietly stop mid-article with
            // nothing shown to the user.
            // Never audible, so there's no TTFA to record -- drop the
            // pending sample rather than let it attach to the next play.
            abandonTtfaSample();
            const aborted = err instanceof DOMException && err.name === "AbortError";
            if (!aborted) {
              toast(
                // "stopped early" would be wrong for a resume whose very first
                // chunk failed -- nothing played, so it never started.
                i === startIndex
                  ? "Couldn't start reading aloud. Please try again."
                  : "Reading aloud stopped early — the audio couldn't be loaded.",
              );
            }
            setStatus("idle");
            return;
          }
          // startIndex, not 0 -- on a resume the first chunk the user actually
          // waits for is the one being resumed to, and that wait is what TTFA
          // means here. Keyed off 0 it would never fire on a resumed play.
          if (i === startIndex) markFirstChunkReady();
          inFlight.delete(i);
          if (generationRef.current !== myGeneration) return;

          const chunkText = chunks[i];
          setCurrentChunkText(chunkText);
          setCurrentChunkIndex(i);
          setCurrentWordRange(null);

          const url = URL.createObjectURL(blob);
          revokeObjectUrl();
          objectUrlRef.current = url;

          const audioEl = new Audio(url);
          audioEl.volume = readerRef.current.ttsVolume;
          audioElRef.current = audioEl;

          // Word-level read-along: Kokoro doesn't emit real per-word
          // timestamps, so this estimates each word's on-screen moment by
          // treating its share of the chunk's own character length as its
          // share of the chunk's playback duration -- not exact (real
          // speech doesn't pace perfectly evenly), but close enough to
          // track along by by eye, and it needs zero extra data from the
          // server. Using the *full* chunk length as the denominator
          // (not just the words' own lengths) naturally leaves the
          // in-between-word gaps their proportional share of time too,
          // instead of words running together back-to-back.
          const wordSpans = wordSpansOf(chunkText);
          const handleTimeUpdate = () => {
            const duration = audioEl.duration;
            if (!duration || !Number.isFinite(duration) || wordSpans.length === 0) return;

            // Listening position (#152): this chunk's index plus how far into
            // it playback has reached, over the total. Interpolating within
            // the chunk rather than using the bare index matters at this
            // app's chunk sizes -- an 80-140 character chunk is only a few
            // seconds, but a long article is hundreds of them, and resuming
            // to a chunk boundary would drop up to a whole chunk every time.
            // Written to a ref on every tick and read by the flush timer; see
            // flushListeningPosition for why nothing leaves the tab here.
            listeningArticleIdRef.current = articleId;
            listeningFractionRef.current = Math.min(1, (i + audioEl.currentTime / duration) / chunks.length);

            const charPos = (audioEl.currentTime / duration) * chunkText.length;
            // The gap *between* two words (every word has one right after
            // it) isn't inside either span, so charPos regularly lands in
            // one -- Array#find's old `?? wordSpans[wordSpans.length - 1]`
            // fallback for "no span contains this point" meant every single
            // inter-word gap, not just the end of the chunk, jumped the
            // highlight to the chunk's very *last* word before snapping
            // back once charPos re-entered a real span. That's the
            // "skips around" bug, confirmed by hand: it doesn't drift or
            // lag, it visibly teleports to the end and back, once per word,
            // for the whole chunk. Holding on the last word whose start is
            // behind charPos instead -- the word that just finished, until
            // the next one's span actually begins -- is both correct and
            // how karaoke-style tracking is expected to behave through a
            // gap in the first place.
            let word = wordSpans[0];
            for (const span of wordSpans) {
              if (span.start > charPos) break;
              word = span;
            }
            setCurrentWordRange(word);
          };
          audioEl.addEventListener("timeupdate", handleTimeUpdate);

          await new Promise<void>((resolve) => {
            resolveCurrentChunkRef.current = resolve;
            audioEl.onended = () => resolve();
            audioEl.onerror = () => resolve();
            audioEl
              .play()
              .then(() => {
                if (firstChunkStarted) return;
                firstChunkStarted = true;
                // Measured here rather than where play() is *called*: this
                // resolves when audio is genuinely audible, which is the
                // only definition of "time to first audio" worth reporting.
                markFirstAudio(blob.size);
                if (generationRef.current === myGeneration) setStatus("playing");
              })
              .catch(() => resolve());
          });
          audioEl.removeEventListener("timeupdate", handleTimeUpdate);
          resolveCurrentChunkRef.current = null;

          if (generationRef.current !== myGeneration) return;
        }
      } finally {
        if (generationRef.current === myGeneration) {
          setStatus("idle");
          setArticleId(null);
          setArticleTitle(null);
          setCurrentChunkText(null);
          setCurrentWordRange(null);
        }
      }
    },
    [revokeObjectUrl, toast],
  );

  const play = useCallback(
    (newArticleId: string, newArticleTitle: string, text: string, startFraction = 0) => {
      if (!supported || !text.trim()) return;
      stop();
      setArticleId(newArticleId);
      setArticleTitle(newArticleTitle);
      if (isKokoroVoice(reader.ttsVoice)) {
        playKokoro(newArticleId, text, startFraction);
      } else {
        // The native SpeechSynthesis path speaks the whole text in one
        // browser-internal call with no chunk boundaries to start from, so
        // there is nowhere to resume to -- it always starts at the beginning.
        // reader-view.tsx only offers the resume prompt for Kokoro voices for
        // this reason; this is the backstop.
        playNative(text);
      }
    },
    [supported, reader.ttsVoice, stop, playKokoro, playNative],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    if (isKokoroVoice(reader.ttsVoice)) {
      audioElRef.current?.pause();
    } else {
      window.speechSynthesis.pause();
    }
    setStatus("paused");
  }, [supported, reader.ttsVoice]);

  const resume = useCallback(() => {
    if (!supported) return;
    if (isKokoroVoice(reader.ttsVoice)) {
      audioElRef.current?.play();
    } else {
      window.speechSynthesis.resume();
    }
    setStatus("playing");
  }, [supported, reader.ttsVoice]);

  return (
    <TtsPlayerContext.Provider
      value={{
        status,
        supported,
        articleId,
        articleTitle,
        currentChunkText,
        currentChunkIndex,
        totalChunks,
        currentWordRange,
        play,
        pause,
        resume,
        stop,
        prewarmFirstChunk,
      }}
    >
      {children}
    </TtsPlayerContext.Provider>
  );
}

export function useTtsPlayer(): TtsPlayerContextValue {
  const ctx = useContext(TtsPlayerContext);
  if (!ctx) throw new Error("useTtsPlayer must be used within a TtsPlayerProvider");
  return ctx;
}
