"use client";

import { useEffect, useState, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape-to-close, Tab kept inside the dialog, and focus handed back to
 * whatever opened it.
 *
 * save-article-modal.tsx already did all three, with the reasoning that
 * matters written out there: the backdrop covers the page but isn't inert, so
 * Tab walks straight out of the dialog into the page underneath -- invisible
 * to a sighted keyboard user, since the backdrop hides where focus has gone.
 * ConfirmDialog, RenameDialog and the command palette are the same kind of
 * thing (portaled to <body>, aria-modal, Escape-dismissable) and had only the
 * Escape half, so this is that modal's behaviour lifted to where all four can
 * share it rather than a fourth variation on it.
 *
 * `onEscape` is read through a ref-free dependency on purpose -- callers pass
 * a fresh arrow every render, and re-binding two document listeners per
 * keystroke is not worth avoiding here, but re-running the *focus* half would
 * be: it would steal focus back to the first element on every re-render, so
 * initial focus and restore live in their own mount-only effect below.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      // offsetParent is null for display:none elements (a hidden file input,
      // a collapsed panel) -- querySelectorAll alone still matches those,
      // which throws off which element is really first and last.
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [ref, onEscape]);

  // Captured by a lazy initializer, i.e. during the first render, not in an
  // effect: every dialog using this focuses something of its own on mount
  // (autoFocus during commit, or its own focus() effect), both of which
  // happen before a passive effect here could read activeElement -- so an
  // effect would capture the dialog's own control and "restoring" focus
  // would put it on an element that no longer exists.
  const [previouslyFocused] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => () => previouslyFocused?.focus?.(), [previouslyFocused]);
}
