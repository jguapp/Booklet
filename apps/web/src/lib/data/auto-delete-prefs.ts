/**
 * Auto-delete stale unread articles -- device-local (not account-synced)
 * and off by default, same as the hoarding-prevention toggle it sits next
 * to in Settings. "Delete" here means trash (see trashArticleById), not a
 * permanent removal -- still reversible for 30 days, same safety net as
 * every other delete path in the app.
 */
const KEY = "booklet-auto-delete-prefs";

export interface AutoDeletePrefs {
  enabled: boolean;
  /** Trash an UNREAD article once it's been sitting for this many days. */
  days: number;
}

const DEFAULT_PREFS: AutoDeletePrefs = { enabled: false, days: 90 };

export function loadAutoDeletePrefs(): AutoDeletePrefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_PREFS.enabled,
      days: typeof parsed.days === "number" && parsed.days >= 1 && parsed.days <= 3650 ? parsed.days : DEFAULT_PREFS.days,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveAutoDeletePrefs(prefs: AutoDeletePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort only
  }
}
