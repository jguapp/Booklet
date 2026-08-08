import type { StoredHighlight } from "./highlight-store";

export interface ImportRequest {
  type: "booklet-import-page";
  url: string;
  highlights: StoredHighlight[];
}

export type ImportResponse =
  | { ok: true; articleId: string; importedCount: number }
  | { ok: false; error: "not_signed_in" | "save_failed" | "highlights_failed"; message: string };

/**
 * How many highlights one import may carry. A page cannot realistically have
 * thousands, and each one is a separate authenticated POST in the background
 * script -- an unbounded array is a way to make the user's own credentials
 * hammer their own API.
 */
const MAX_HIGHLIGHTS = 500;

/** Long enough for a real quoted passage, short enough that the API isn't
 * being used as blob storage. */
const MAX_TEXT_LENGTH = 20_000;

function isStoredHighlight(value: unknown): value is StoredHighlight {
  if (typeof value !== "object" || value === null) return false;
  const h = value as StoredHighlight;
  return (
    typeof h.exact === "string" &&
    h.exact.length > 0 &&
    h.exact.length <= MAX_TEXT_LENGTH &&
    typeof h.prefix === "string" &&
    h.prefix.length <= MAX_TEXT_LENGTH &&
    typeof h.suffix === "string" &&
    h.suffix.length <= MAX_TEXT_LENGTH &&
    Number.isInteger(h.start) &&
    h.start >= 0 &&
    Number.isInteger(h.end) &&
    h.end > h.start
  );
}

/**
 * The background script's trust boundary, so this validates the whole
 * message rather than just enough of it to narrow the type.
 *
 * The sender is not necessarily our own content script. `externally_connectable`
 * is not declared in manifest.json, and Chrome's default for that is "no web
 * pages, but any other installed extension" -- so a second extension on the
 * same profile can call chrome.runtime.sendMessage against this one. Whatever
 * arrives is then used to make authenticated API calls with the user's token.
 * The listener in background.ts additionally checks who sent it; this checks
 * that what they sent is shaped like an import at all, so a malformed
 * `highlights` cannot throw part-way through importPage, after the page has
 * already been saved.
 */
export function isImportRequest(value: unknown): value is ImportRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as ImportRequest;
  if (message.type !== "booklet-import-page") return false;
  if (typeof message.url !== "string" || !/^https?:\/\//.test(message.url)) return false;
  if (!Array.isArray(message.highlights)) return false;
  if (message.highlights.length > MAX_HIGHLIGHTS) return false;
  return message.highlights.every(isStoredHighlight);
}
