"use client";

import { useEffect } from "react";

/**
 * Drag-and-drop onto the Trash nav link (app layout.tsx) -- articles
 * (library/favorites cards) and highlights (highlight-list-item, used on
 * both the Highlights dashboard and Daily Review) are both draggable, and
 * dropping either on Trash moves it there the same as its trash-icon
 * button would.
 *
 * The drop handler lives in the shared app layout, which has no access to
 * any individual page's local `articles`/`highlights` state -- rather than
 * threading that through, a successful drop fires a DOM CustomEvent that
 * whatever page is currently mounted listens for and reacts to by
 * re-running its own existing refresh(), the same one it already uses
 * after any other mutation.
 */
export const ARTICLE_DRAG_MIME = "application/x-booklet-article-id";
export const HIGHLIGHT_DRAG_MIME = "application/x-booklet-highlight-id";

const TRASHED_EVENT = "booklet:trashed";

export function notifyTrashed(): void {
  window.dispatchEvent(new CustomEvent(TRASHED_EVENT));
}

export function useOnTrashed(onTrashed: () => void): void {
  useEffect(() => {
    window.addEventListener(TRASHED_EVENT, onTrashed);
    return () => window.removeEventListener(TRASHED_EVENT, onTrashed);
  }, [onTrashed]);
}
