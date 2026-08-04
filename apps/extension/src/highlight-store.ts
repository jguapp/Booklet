import type { TextAnchor } from "./text-anchor";

export interface StoredHighlight extends TextAnchor {
  id: string;
  createdAt: string;
}

const KEY_PREFIX = "booklet_page_highlights:";

/**
 * Storage key for a page's pending highlights.
 *
 * Deliberately *not* the shared `canonicalizeUrl`: this key only has to stop
 * one page's highlights forking across cosmetic URL variants in local
 * storage, and the extension doesn't depend on @booklet/shared (pulling it in
 * would mean building that package before the extension in a CI job that
 * currently doesn't). The authoritative `Article.canonicalUrl` is still
 * computed server-side from the URL we send at import time, so nothing about
 * duplicate detection rests on this.
 */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|msclkid|mc_(cid|eid)|ref|si$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return KEY_PREFIX + parsed.toString();
  } catch {
    return KEY_PREFIX + url;
  }
}

export async function getPageHighlights(url: string): Promise<StoredHighlight[]> {
  const key = pageKey(url);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return Array.isArray(value) ? (value as StoredHighlight[]) : [];
}

export async function setPageHighlights(url: string, highlights: StoredHighlight[]): Promise<void> {
  const key = pageKey(url);
  if (highlights.length === 0) {
    await chrome.storage.local.remove(key);
    return;
  }
  await chrome.storage.local.set({ [key]: highlights });
}
