import type { Highlight } from "@booklet/shared";
import { localHighlights } from "@/lib/local/db";

/**
 * Local-only for now, same as mock/store.ts before it -- this swaps the
 * storage backend from a single localStorage JSON blob to IndexedDB.
 * Server sync (POST /api/highlights et al.) lands in a later phase; when it
 * does, this gains the same authenticated-branch shape as lib/data/articles.ts.
 */
export async function loadHighlights(): Promise<Highlight[]> {
  return localHighlights.getAll();
}

export async function saveHighlights(highlights: Highlight[]): Promise<void> {
  return localHighlights.replaceAll(highlights);
}

export const LOCAL_USER_ID = "local";
