import type { ResurfaceFrequency } from "@booklet/shared";

/**
 * Local-only settings persistence for anonymous (no-account) users. Article
 * and highlight storage moved to IndexedDB (lib/local/db.ts, via
 * lib/data/*) -- this is what's left of the original mock store, since
 * settings are small enough that a localStorage blob is still the right
 * tool. Signed-in users read/write settings through PATCH /api/auth/me
 * instead (see the settings page).
 */

const SETTINGS_KEY = "booklet-mock-settings-v1";

export interface UserSettings {
  resurfaceFrequency: ResurfaceFrequency;
  highlightsPerDigest: number;
}

const DEFAULT_SETTINGS: UserSettings = { resurfaceFrequency: "DAILY", highlightsPerDigest: 5 };

function load<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort only
  }
}

function looksLikeSettings(value: unknown): value is UserSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.resurfaceFrequency === "DAILY" || v.resurfaceFrequency === "WEEKLY") &&
    typeof v.highlightsPerDigest === "number"
  );
}

export function loadUserSettings(): UserSettings {
  return load(SETTINGS_KEY, DEFAULT_SETTINGS, looksLikeSettings);
}

export function saveUserSettings(settings: UserSettings): void {
  save(SETTINGS_KEY, settings);
}
