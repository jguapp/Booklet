/**
 * Whether the Stats page/nav item is shown -- off by default (it's a
 * "payoff" view, not something everyone wants cluttering the sidebar) and
 * device-local, same as the hoarding-prevention toggle it sits next to in
 * Settings.
 */
const KEY = "booklet-show-reading-stats";

export function loadShowReadingStats(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "true";
}

export function saveShowReadingStats(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // best-effort only
  }
}
