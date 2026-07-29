/**
 * The "knowledge hoarding" backlog limit -- device-local (not account-
 * synced) and off by default. When enabled, saving a new article while the
 * unread count is already at/over the limit surfaces a real choice instead
 * of silently growing an unread pile that never gets touched -- see
 * library/page.tsx's handleSaveClick.
 */
const KEY = "booklet-hoarding-prefs";

export interface HoardingPrefs {
  enabled: boolean;
  maxUnread: number;
}

const DEFAULT_PREFS: HoardingPrefs = { enabled: false, maxUnread: 25 };

export function loadHoardingPrefs(): HoardingPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_PREFS.enabled,
      maxUnread:
        typeof parsed.maxUnread === "number" && parsed.maxUnread >= 1 && parsed.maxUnread <= 500
          ? parsed.maxUnread
          : DEFAULT_PREFS.maxUnread,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveHoardingPrefs(prefs: HoardingPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort only
  }
}
