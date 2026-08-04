"use client";

import { useEffect, useRef } from "react";

// Below this, a `visibilitychange` and a `focus` firing back to back for the
// same tab switch (both do, in most browsers) would otherwise trigger two
// near-simultaneous refetches instead of one.
const DEDUPE_WINDOW_MS = 300;

/**
 * Silently re-runs `refresh` whenever this tab becomes the one being looked
 * at again, so a save made somewhere this page has no live channel to --
 * the browser extension (a different origin: chrome-extension://, so
 * nothing short of this can reach an already-open library tab), a second
 * tab, another device -- shows up the moment someone actually looks at the
 * page, with no manual reload. A same-tab save already updates its own
 * local state directly (see each page's own onSaved/mutation handlers);
 * this only covers everything that state can't see happen.
 *
 * Both events are wired because neither is reliable alone across every
 * OS/browser window-switching path (e.g. focus doesn't fire on some mobile
 * "return to browser" transitions that visibilitychange does, and vice
 * versa for some virtual-desktop switches).
 *
 * Only fires after this tab has genuinely been away and come back --
 * requires an observed hidden/blur first. A brand-new page routinely gets
 * an initial `focus` right on load (real browsers do this, and Playwright's
 * page.goto does too), which is not a "came back to this tab" event; without
 * this guard every navigation would fire the mount effect's own fetch AND
 * this one back to back, doubling load for no reason a user would notice.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  const lastRunRef = useRef(0);
  const wasAwayRef = useRef(false);

  useEffect(() => {
    function trigger() {
      if (!wasAwayRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < DEDUPE_WINDOW_MS) return;
      lastRunRef.current = now;
      wasAwayRef.current = false;
      refresh();
    }
    function markAway() {
      wasAwayRef.current = true;
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") markAway();
      else trigger();
    }

    window.addEventListener("focus", trigger);
    window.addEventListener("blur", markAway);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", trigger);
      window.removeEventListener("blur", markAway);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);
}
