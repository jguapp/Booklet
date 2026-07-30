/**
 * Reader preferences (text size, TTS reading rate/voice) that live on this
 * device only -- not synced through the account like resurfaceFrequency/
 * highlightsPerDigest (lib/mock/store.ts). Ideal text size, reading speed,
 * and which TTS voice sounds best to you are properties of the device/
 * screen/ear, not the account, so unlike the rest of Settings these apply
 * the same way whether signed in or not.
 */
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { KOKORO_VOICES, NATIVE_VOICE_ID } from "./kokoro-tts";

const KEY = "booklet-reader-prefs";
const SIZES: ReaderSize[] = ["sm", "md", "lg", "xl"];
const VALID_VOICES = new Set([NATIVE_VOICE_ID, ...KOKORO_VOICES.map((v) => v.id)]);

export interface ReaderPrefs {
  size: ReaderSize;
  ttsRate: number;
  /** NATIVE_VOICE_ID (the device's own SpeechSynthesis) or a Kokoro voice id. */
  ttsVoice: string;
}

const DEFAULT_PREFS: ReaderPrefs = { size: "md", ttsRate: 1, ttsVoice: NATIVE_VOICE_ID };

export function loadReaderPrefs(): ReaderPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      size: SIZES.includes(parsed.size) ? parsed.size : DEFAULT_PREFS.size,
      ttsRate:
        typeof parsed.ttsRate === "number" && parsed.ttsRate >= 0.5 && parsed.ttsRate <= 2
          ? parsed.ttsRate
          : DEFAULT_PREFS.ttsRate,
      ttsVoice: typeof parsed.ttsVoice === "string" && VALID_VOICES.has(parsed.ttsVoice)
        ? parsed.ttsVoice
        : DEFAULT_PREFS.ttsVoice,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort only
  }
}
