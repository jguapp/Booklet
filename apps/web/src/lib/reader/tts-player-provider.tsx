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
  play: (articleId: string, articleTitle: string, text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const TtsPlayerContext = createContext<TtsPlayerContextValue | null>(null);

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

      // Fetch-ahead pipelining: chunk i+1's request is already in flight by
      // the time chunk i starts playing, so by the time chunk i's playback
      // finishes, chunk i+1 is usually already sitting ready. A plain
      // network request, not a Worker -- see the module doc comment for
      // why that's enough this time.
      let nextChunkPromise = chunks.length > 0 ? generateKokoroChunk(chunks[0], readerRef.current.ttsVoice, readerRef.current.ttsRate) : null;

      let firstChunkStarted = false;
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (generationRef.current !== myGeneration) return;
          if (!nextChunkPromise) break;

          let blob: Blob;
          try {
            blob = await nextChunkPromise;
          } catch {
            if (generationRef.current === myGeneration) setStatus("idle");
            return;
          }
          if (generationRef.current !== myGeneration) return;

          nextChunkPromise =
            i + 1 < chunks.length ? generateKokoroChunk(chunks[i + 1], readerRef.current.ttsVoice, readerRef.current.ttsRate) : null;

          setCurrentChunkText(chunks[i]);
          setCurrentChunkIndex(i);

          const url = URL.createObjectURL(blob);
          revokeObjectUrl();
          objectUrlRef.current = url;

          const audioEl = new Audio(url);
          audioEl.volume = readerRef.current.ttsVolume;
          audioElRef.current = audioEl;

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
          resolveCurrentChunkRef.current = null;

          if (generationRef.current !== myGeneration) return;
        }
      } finally {
        if (generationRef.current === myGeneration) {
          setStatus("idle");
          setArticleId(null);
          setArticleTitle(null);
          setCurrentChunkText(null);
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
