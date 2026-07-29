/**
 * Reader preferences (text size, TTS reading rate) that live on this device
 * only -- not synced through the account like resurfaceFrequency/
 * highlightsPerDigest (lib/mock/store.ts). Ideal text size and reading
 * speed are properties of the device/screen/ear, not the account, so
 * unlike the rest of Settings these apply the same way whether signed in
 * or not.
 */
import type { ReaderSize } from "@/components/reader/reader-toolbar";

const KEY = "booklet-reader-prefs";
const SIZES: ReaderSize[] = ["sm", "md", "lg", "xl"];

export interface ReaderPrefs {
  size: ReaderSize;
  ttsRate: number;
}

const DEFAULT_PREFS: ReaderPrefs = { size: "md", ttsRate: 1 };

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
