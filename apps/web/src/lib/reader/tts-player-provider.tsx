"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { pickBestVoice } from "./tts-voice";
import { isKokoroVoice, generateKokoroChunk, toSafeTextChunks } from "./kokoro-tts";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";

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
  play: (articleId: string, articleTitle: string, text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Speculatively starts generating just the article's first chunk before
   * the user has pressed play at all -- see its own comment below for why. */
  prewarmFirstChunk: (articleId: string, text: string) => void;
}

const TtsPlayerContext = createContext<TtsPlayerContextValue | null>(null);

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
  const readerRef = useRef(reader);
  // Synced via effect, not written during render (React refs are only safe
  // to read/write outside of render -- effects, event handlers, etc.) --
  // read fresh inside the play loop below without retriggering it on every
  // rate/voice/volume change.
  useEffect(() => {
    readerRef.current = reader;
  }, [reader]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);
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
      if (!supported || !isKokoroVoice(reader.ttsVoice) || !text.trim()) return;
      const chunkText = toSafeTextChunks(text)[0];
      if (!chunkText) return;
      const existing = prewarmedRef.current;
      // Reader-view calls this reactively on every relevant render, most of
      // which change nothing that actually matters here -- skip re-issuing
      // an identical request rather than firing a new one (and abandoning
      // the still-in-flight old one) every time.
      if (
        existing &&
        existing.articleId === articleId &&
        existing.chunkText === chunkText &&
        existing.voice === reader.ttsVoice &&
        existing.rate === reader.ttsRate
      ) {
        return;
      }
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
      prewarmedRef.current = { articleId, chunkText, voice: reader.ttsVoice, rate: reader.ttsRate, promise, controller };
    },
    [supported, reader.ttsVoice, reader.ttsRate],
  );

  const stop = useCallback(() => {
    generationRef.current++; // abandon any in-flight chunk loop
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
  }, [supported, revokeObjectUrl]);

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
    async (articleId: string, text: string) => {
      const myGeneration = ++generationRef.current;
      setStatus("loading");

      const chunks = toSafeTextChunks(text);
      setTotalChunks(chunks.length);

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
      let nextToPrefetch = 0;

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
      } else {
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
        for (let i = 0; i < chunks.length; i++) {
          if (generationRef.current !== myGeneration) return;
          ensurePrefetched(i + PREFETCH_DEPTH - 1);

          let blob: Blob;
          try {
            blob = await inFlight.get(i)!;
          } catch {
            if (generationRef.current === myGeneration) setStatus("idle");
            return;
          }
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
    [revokeObjectUrl],
  );

  const play = useCallback(
    (newArticleId: string, newArticleTitle: string, text: string) => {
      if (!supported || !text.trim()) return;
      stop();
      setArticleId(newArticleId);
      setArticleTitle(newArticleTitle);
      if (isKokoroVoice(reader.ttsVoice)) {
        playKokoro(newArticleId, text);
      } else {
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
