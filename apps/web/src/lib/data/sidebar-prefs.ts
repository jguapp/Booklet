/**
 * "Compact mode" for the left nav -- collapses to an icon-only rail and
 * pops out on hover (like Zen Browser's sidebar auto-hide) instead of
 * permanently occupying its full width. Device-local, off by default.
 */
const KEY = "booklet-sidebar-compact";

export function loadSidebarCompact(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "true";
}

export function saveSidebarCompact(compact: boolean): void {
  try {
    localStorage.setItem(KEY, String(compact));
  } catch {
    // best-effort only
  }
}
