"use client";

import { useEffect } from "react";

/**
 * The sidebar (app layout.tsx) owns the collections list it renders, but
 * doesn't re-fetch on every navigation -- only when auth state changes
 * (see its refreshCollections effect). Creating a collection from
 * somewhere other than the sidebar's own "+" form (e.g. Library's "Save
 * as collection") needs a way to tell it to refresh; same
 * dispatch-a-DOM-event-and-listen pattern as trash-drop.ts's
 * notifyTrashed/useOnTrashed, for the same reason (no direct access to
 * another mounted component's state).
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
