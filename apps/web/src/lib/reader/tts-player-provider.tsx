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

  const stop = useCallback(() => {
    generationRef.current++; // abandon any in-flight chunk loop
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
    async (text: string) => {
      const myGeneration = ++generationRef.current;
      setStatus("loading");

      const chunks = toSafeTextChunks(text);
      setTotalChunks(chunks.length);

      // Sliding-window prefetch, not just one chunk ahead: the server runs
      // a small pool of real concurrent generation processes now (see
      // apps/api's tts-pool.ts), so keeping several requests in flight at
      // once is what actually uses that concurrency -- one-ahead prefetch
      // just meant this client was never the bottleneck, but a *single*
      // server process still was. PREFETCH_DEPTH matches the pool's own
      // default size (3) so the window keeps every worker busy without
      // queuing more than the server can actually run at once.
      const PREFETCH_DEPTH = 3;
      const inFlight = new Map<number, Promise<Blob>>();
      const ensurePrefetched = (uptoIndexInclusive: number) => {
        for (let i = 0; i <= uptoIndexInclusive && i < chunks.length; i++) {
          if (!inFlight.has(i)) {
            inFlight.set(i, generateKokoroChunk(chunks[i], readerRef.current.ttsVoice, readerRef.current.ttsRate));
          }
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
            const word = wordSpans.find((w) => charPos >= w.start && charPos < w.end) ?? wordSpans[wordSpans.length - 1];
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
        playKokoro(text);
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
