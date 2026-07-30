/**
 * Reader preferences (text size, TTS reading rate/voice) that live on this
 * device only -- not synced through the account like resurfaceFrequency/
 * highlightsPerDigest (lib/mock/store.ts). Ideal text size, reading speed,
 * and which TTS voice sounds best to you are properties of the device/
 * screen/ear, not the account, so unlike the rest of Settings these apply
 * the same way whether signed in or not.
 */
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { DEFAULT_HIGHLIGHT_BAR_COLORS, sanitizeHighlightBarColors } from "@booklet/shared";
import { KOKORO_VOICES, NATIVE_VOICE_ID } from "./kokoro-tts";

const KEY = "booklet-reader-prefs";
const SIZES: ReaderSize[] = ["sm", "md", "lg", "xl"];
const VALID_VOICES = new Set([NATIVE_VOICE_ID, ...KOKORO_VOICES.map((v) => v.id)]);

export interface ReaderPrefs {
  size: ReaderSize;
  ttsRate: number;
  /** NATIVE_VOICE_ID (the device's own SpeechSynthesis) or a Kokoro voice id. */
  ttsVoice: string;
  /** Which colors show up in the highlight picker, and in what order --
   * see packages/shared highlight-colors.ts. */
  highlightBarColors: string[];
  /** A persistent, Kindle-style bottom bar showing % complete and time
   * left, visible regardless of scroll/page position -- optional since
   * not everyone wants a constant reminder of how much is left. */
  showProgressBar: boolean;
}

const DEFAULT_PREFS: ReaderPrefs = {
  size: "md",
  ttsRate: 1,
  ttsVoice: NATIVE_VOICE_ID,
  highlightBarColors: DEFAULT_HIGHLIGHT_BAR_COLORS,
  showProgressBar: true,
};

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
      highlightBarColors: sanitizeHighlightBarColors(parsed.highlightBarColors),
      showProgressBar: typeof parsed.showProgressBar === "boolean" ? parsed.showProgressBar : DEFAULT_PREFS.showProgressBar,
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
