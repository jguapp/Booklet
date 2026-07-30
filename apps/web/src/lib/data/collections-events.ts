"use client";

import { useEffect } from "react";

/**
 * A collection created from a library card's "Add to collection" menu
 * (collection-menu.tsx) needs the sidebar (app layout.tsx) to pick it up --
 * but the sidebar owns its own independent `collections` state, with no
 * parent/child relationship to whichever page's card triggered the create.
 * Same shape as trash-drop.ts's notifyTrashed()/useOnTrashed(), just in the
 * opposite direction: a page notifies the shared layout, instead of the
 * layout notifying whichever page is mounted.
 */
const COLLECTIONS_CHANGED_EVENT = "booklet:collections-changed";

export function notifyCollectionsChanged(): void {
  window.dispatchEvent(new CustomEvent(COLLECTIONS_CHANGED_EVENT));
}

export function useOnCollectionsChanged(onChanged: () => void): void {
  useEffect(() => {
    window.addEventListener(COLLECTIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COLLECTIONS_CHANGED_EVENT, onChanged);
  }, [onChanged]);
}
