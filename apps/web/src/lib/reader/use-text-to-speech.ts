"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickBestVoice } from "./tts-voice";
import { loadReaderPrefs } from "./device-prefs";

export type TtsStatus = "idle" | "playing" | "paused";

interface UseTextToSpeechResult {
  status: TtsStatus;
  supported: boolean;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/**
 * Thin wrapper over the browser's native SpeechSynthesis -- no external
 * service, no API key, works offline. `text` is read fresh from the start
 * whenever play() is called; changing `text` while already playing (e.g.
 * the reader turned a page) stops the current utterance rather than trying
 * to splice speech mid-sentence.
 */
export function useTextToSpeech(text: string): UseTextToSpeechResult {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  // The voice list loads asynchronously in most browsers -- empty on the
  // first call until `voiceschanged` fires -- so keep the best pick current
  // as it becomes available rather than freezing an empty result at mount.
  useEffect(() => {
    if (!supported) return;
    function refreshVoice() {
      voiceRef.current = pickBestVoice(window.speechSynthesis.getVoices(), document.documentElement.lang || "en");
    }
    refreshVoice();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoice);
  }, [supported]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setStatus("idle");
  }, [supported]);

  // A page turn/chapter change swaps `text` out from under an in-progress
  // utterance -- there's no clean way to resume mid-sentence in different
  // content, so just stop (which also resets `status`) rather than keep
  // reading stale text. This cleanup also covers unmount.
  useEffect(() => {
    return stop;
  }, [text, stop]);

  const play = useCallback(() => {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = loadReaderPrefs().ttsRate;
    utterance.onend = () => setStatus("idle");
    utterance.onerror = () => setStatus("idle");
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setStatus("playing");
  }, [supported, text]);

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setStatus("paused");
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setStatus("playing");
  }, [supported]);

  return { status, supported, play, pause, resume, stop };
}
