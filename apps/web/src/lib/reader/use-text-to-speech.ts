"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickBestVoice } from "./tts-voice";
import { isKokoroVoice, loadKokoro, toSafeTextStream, type KokoroVoiceId } from "./kokoro-tts";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";

export type TtsStatus = "idle" | "loading" | "playing" | "paused";

interface UseTextToSpeechResult {
  status: TtsStatus;
  supported: boolean;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * Two engines behind one interface: the browser's native SpeechSynthesis
 * (zero cost, zero setup, works offline, but voice quality is whatever's
 * installed on the OS) and Kokoro (kokoro-tts.ts -- also zero cost, but a
 * genuinely natural-sounding open-source model running client-side via
 * WASM/WebGPU). Which one plays is decided per-call by `reader.ttsVoice`
 * (device-prefs.ts), not baked into the hook -- so switching voices in
 * Settings takes effect on the next play() with no reader-view.tsx changes
 * needed. `text` is read fresh from the start whenever play() is called;
 * changing `text` while already playing (e.g. the reader turned a page)
 * stops the current playback rather than trying to splice speech mid-
 * sentence.
 */
export function useTextToSpeech(text: string): UseTextToSpeechResult {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const supported = typeof window !== "undefined";
  const { reader } = useDevicePrefs();

  // Kokoro plays through a real <audio> element (not raw Web Audio API
  // buffers) so pause/resume are free. `generation` increments on every
  // stop()/text change so an in-flight stream loop from a previous play()
  // knows to abandon itself instead of racing a newly-started one.
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

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current++; // abandon any in-flight Kokoro stream loop
    if (supported && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    audioElRef.current?.pause();
    audioElRef.current = null;
    resolveCurrentChunkRef.current?.(); // unstick the stream loop's await, if any
    resolveCurrentChunkRef.current = null;
    revokeObjectUrl();
    setStatus("idle");
  }, [supported, revokeObjectUrl]);

  // A page turn/chapter change swaps `text` out from under an in-progress
  // playback -- there's no clean way to resume mid-sentence in different
  // content, so just stop (which also resets `status`) rather than keep
  // reading stale text. This cleanup also covers unmount.
  useEffect(() => {
    return stop;
  }, [text, stop]);

  const playNative = useCallback(() => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = reader.ttsRate;
    utterance.onend = () => setStatus("idle");
    utterance.onerror = () => setStatus("idle");
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }, [text, reader.ttsRate]);

  // Generates and plays one sentence-grouped chunk at a time (kokoro-js's
  // own tts.stream(), not a hand-rolled splitter) -- a whole multi-thousand-
  // word article in one generate() call would be slow to start and memory-
  // heavy client-side. Each chunk is generated only once the previous one
  // has finished playing -- NOT pipelined ahead of playback, despite that
  // sounding like a free win: confirmed by hand that it isn't. kokoro-js's
  // WASM inference runs on the main thread (no Worker), and a monolithic
  // WASM forward-pass call doesn't yield back to the event loop
  // cooperatively while it runs -- so kicking off the next chunk's
  // generation before the current chunk's audioEl.play() has actually
  // started blocks that same main thread the audio element needs to fire
  // its own play()/'canplay' events on. In testing this didn't shrink the
  // gap, it starved playback of the first chunk entirely (the "playing"
  // status never appeared within a 150s test timeout). A real fix would
  // need generation moved to a Worker (raw PCM handed back to the main
  // thread for playback, not a WASM call sharing the UI thread) -- out of
  // scope for this pass.
  const playKokoro = useCallback(async () => {
    const myGeneration = ++generationRef.current;
    setStatus("loading");

    let tts;
    try {
      tts = await loadKokoro();
    } catch {
      if (generationRef.current === myGeneration) setStatus("idle");
      return;
    }
    if (generationRef.current !== myGeneration) return; // stopped while the model was loading

    // Stay "loading" through the first chunk's generation too, not just the
    // model download -- flipping to "playing" here (before anything has
    // actually started playing) is exactly the "says playing but I don't
    // hear anything" gap: generating the first chunk of real speech from a
    // freshly-loaded model can itself take several seconds. Only the first
    // chunk needs this; by the second, "playing" already reflects reality.
    let firstChunkStarted = false;
    try {
      // Cast is safe: reader.ttsVoice is validated against KOKORO_VOICES'
      // ids in device-prefs.ts's loadReaderPrefs, and isKokoroVoice() above
      // already ruled out NATIVE_VOICE_ID -- kokoro-js just doesn't export
      // that exact literal union for callers to type against directly.
      const voice = reader.ttsVoice as KokoroVoiceId;
      for await (const { audio } of tts.stream(toSafeTextStream(text), { voice, speed: reader.ttsRate })) {
        if (generationRef.current !== myGeneration) return; // stopped mid-stream

        const url = URL.createObjectURL(audio.toBlob());
        revokeObjectUrl();
        objectUrlRef.current = url;

        const audioEl = new Audio(url);
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

        if (generationRef.current !== myGeneration) return; // stop() during this chunk
      }
    } finally {
      if (generationRef.current === myGeneration) setStatus("idle");
    }
  }, [text, reader.ttsVoice, reader.ttsRate, revokeObjectUrl]);

  const play = useCallback(() => {
    if (!supported || !text.trim()) return;
    if (isKokoroVoice(reader.ttsVoice)) {
      playKokoro();
    } else {
      playNative();
    }
  }, [supported, text, reader.ttsVoice, playKokoro, playNative]);

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

  return { status, supported, play, pause, resume, stop };
}
