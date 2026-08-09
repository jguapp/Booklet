/**
 * Reader preferences that live on this device only -- the mobile analog of
 * the web app's lib/reader/device-prefs.ts, and deliberately the same
 * philosophy: ideal text size, reading speed, and which voice sounds best
 * are properties of the device/screen/ear, not the account, so they apply
 * the same way whether signed in or not.
 *
 * Narrower than the web's ReaderPrefs on purpose. No ttsVolume (the device
 * has hardware volume buttons in hand), no highlight bar colors / progress
 * bar / PDF mode (no mobile UI for any of them) -- and no NATIVE_VOICE_ID:
 * the web's default voice is the browser's own SpeechSynthesis, which React
 * Native does not have, so mobile read-aloud is server-generated Kokoro
 * audio only and the default is a concrete Kokoro voice.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KOKORO_VOICE_IDS } from "@booklet/shared";

const KEY = "booklet_device_prefs";

export type TextSize = "sm" | "md" | "lg";
export const TEXT_SIZES: { value: TextSize; label: string; fontSize: number; lineHeight: number }[] = [
  { value: "sm", label: "Small", fontSize: 14, lineHeight: 22 },
  { value: "md", label: "Medium", fontSize: 16, lineHeight: 26 },
  { value: "lg", label: "Large", fontSize: 19, lineHeight: 30 },
];

/** Matches the web picker's range; the server validates 0.5-2 too. */
export const TTS_RATES = [0.75, 1, 1.25, 1.5];

/** The reminder hours Settings offers -- morning, lunch, evening. */
export const REMINDER_HOURS = [8, 12, 20];

export interface DevicePrefs {
  textSize: TextSize;
  /** A Kokoro voice id -- see the header for why there's no "system" option. */
  ttsVoice: string;
  ttsRate: number;
  /** Hour (0-23) of the local daily-review reminder; null = off. The
   * notification itself is scheduled through lib/notifications.ts -- this
   * is only what the Settings UI reads back. */
  reviewReminderHour: number | null;
}

export const DEFAULT_PREFS: DevicePrefs = {
  textSize: "md",
  ttsVoice: "af_heart",
  ttsRate: 1,
  reviewReminderHour: null,
};

export async function loadDevicePrefs(): Promise<DevicePrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    // Validated field by field, same as the web loader: a bad or stale
    // stored value falls back to its default rather than poisoning every
    // consumer (an unknown voice id, for instance, would 400 every TTS
    // request until Settings happened to rewrite it).
    return {
      textSize: TEXT_SIZES.some((s) => s.value === parsed.textSize) ? (parsed.textSize as TextSize) : DEFAULT_PREFS.textSize,
      ttsVoice:
        typeof parsed.ttsVoice === "string" && KOKORO_VOICE_IDS.has(parsed.ttsVoice)
          ? parsed.ttsVoice
          : DEFAULT_PREFS.ttsVoice,
      ttsRate:
        typeof parsed.ttsRate === "number" && parsed.ttsRate >= 0.5 && parsed.ttsRate <= 2
          ? parsed.ttsRate
          : DEFAULT_PREFS.ttsRate,
      reviewReminderHour:
        typeof parsed.reviewReminderHour === "number" &&
        Number.isInteger(parsed.reviewReminderHour) &&
        parsed.reviewReminderHour >= 0 &&
        parsed.reviewReminderHour <= 23
          ? parsed.reviewReminderHour
          : DEFAULT_PREFS.reviewReminderHour,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveDevicePrefs(prefs: DevicePrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort only, same as web
  }
}
