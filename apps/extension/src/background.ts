import {
  ApiError,
  STORAGE_KEY,
  createHighlight,
  findArticleByUrl,
  getSession,
  logout,
  saveArticle,
} from "./api";
import { WEB_APP_URL } from "./config";
import { isImportRequest, type ImportResponse } from "./messages";
import type { StoredHighlight } from "./highlight-store";

const MENU_SAVE = "booklet-save-page";
const MENU_LOGOUT = "booklet-logout";

const BADGE_MS = 3000;
const BADGE_OK = "#1F6F6B"; // --color-accent, same as the popup
const BADGE_ERROR = "#B5502F"; // --color-error

/**
 * A popup and an onClicked handler are mutually exclusive: whichever is set
 * wins, and with a popup declared the click event never fires at all. So
 * "one click saves" is expressed by clearing the popup while signed in and
 * putting it back when signed out, rather than by any branching in the click
 * handler itself.
 *
 * Re-run on every service-worker wake (not just install/startup) because an
 * MV3 worker is torn down freely, and this is a single storage read.
 */
async function syncActionBehaviour(): Promise<void> {
  const session = await getSession();

  await chrome.action.setPopup({ popup: session ? "" : "popup.html" });
  await chrome.action.setTitle({
    // The signed-in address has nowhere else to live now that a click no
    // longer opens the popup -- the tooltip is the only always-available
    // surface for "which account is this saving to".
    title: session ? `Save to Booklet (${session.email})` : "Log in to Booklet",
  });

  // update() throws if the item doesn't exist yet, which happens whenever a
  // worker wakes before onInstalled has ever run in this profile.
  await chrome.contextMenus
    .update(MENU_LOGOUT, { visible: Boolean(session) })
    .catch(() => undefined);
}

async function flashBadge(tabId: number | undefined, text: string, color: string): Promise<void> {
  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
  // A worker torn down inside this window leaves the badge up until the next
  // save clears it. Harmless, and the alternative (chrome.alarms) buys a
  // whole extra permission for a cosmetic timeout.
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), BADGE_MS);
}

async function saveTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const tabId = tab?.id;

  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    // about:, chrome://, moz-extension://, view-source:, a blank tab. Nothing
    // to save, and with no popup open there's nowhere to explain that -- so
    // say it in the one place that is visible.
    await flashBadge(tabId, "!", BADGE_ERROR);
    return;
  }

  const session = await getSession();
  if (!session) {
    // Only reachable from the context menu: while signed out the toolbar
    // button still has its popup, so a click opens the login form instead.
    await chrome.action.openPopup().catch(() => undefined);
    return;
  }

  try {
    const result = await saveArticle(tab.url);
    await flashBadge(tabId, result.extractionStatus === "FAILED" ? "!" : "✓", result.extractionStatus === "FAILED" ? BADGE_ERROR : BADGE_OK);
  } catch (err) {
    // Saving something already in the library is the expected outcome of
    // clicking twice, not an error the user needs to do anything about --
    // the page is in Booklet either way, which is all the badge claims.
    if (err instanceof ApiError && err.status === 409) {
      await flashBadge(tabId, "✓", BADGE_OK);
      return;
    }
    await flashBadge(tabId, "!", BADGE_ERROR);
  }
}

/**
 * Save the page, then attach the highlights made on it while reading.
 *
 * Runs here rather than in the content script because the page's own origin
 * can't reach the API -- CORS only allows the extension origin, and the
 * session token deliberately lives in extension storage where page scripts
 * can't read it.
 */
async function importPage(url: string, highlights: StoredHighlight[]): Promise<ImportResponse> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "not_signed_in", message: "Log in to Booklet first." };
  }

  let articleId: string;
  try {
    articleId = (await saveArticle(url)).id;
  } catch (err) {
    // Already in the library: attach to the existing article rather than
    // refusing the import and stranding the highlights.
    if (err instanceof ApiError && err.status === 409) {
      const existing = await findArticleByUrl(url).catch(() => null);
      if (!existing) return { ok: false, error: "save_failed", message: "Couldn't find the saved article." };
      articleId = existing.id;
    } else {
      return {
        ok: false,
        error: "save_failed",
        message: err instanceof ApiError ? err.message : "Couldn't save this page.",
      };
    }
  }

  let importedCount = 0;
  for (const highlight of highlights) {
    try {
      await createHighlight({
        articleId,
        selectedText: highlight.exact,
        position: {
          type: "text",
          exact: highlight.exact,
          prefix: highlight.prefix,
          suffix: highlight.suffix,
          // Offsets into the live page, which is not the string these resolve
          // against -- the server anchors to extractedText and re-finds the
          // quote by prefix/exact/suffix. Sent as the hint that anchoring
          // tries first, not as the source of truth.
          start: highlight.start,
          end: highlight.end,
        },
        color: "YELLOW",
      });
      importedCount += 1;
    } catch {
      // Keep going: one unparseable highlight shouldn't cost the user the
      // other nine. A partial count is reported back honestly below.
    }
  }

  if (importedCount === 0 && highlights.length > 0) {
    return { ok: false, error: "highlights_failed", message: "Saved the page, but no highlights transferred." };
  }

  await chrome.tabs.create({ url: `${WEB_APP_URL}/reader/${articleId}` });
  return { ok: true, articleId, importedCount };
}

/**
 * Whether a message really came from this extension's own content script, in
 * a tab, about the page that tab is actually on.
 *
 * Three separate things are being refused here, and none of them is
 * hypothetical:
 *
 * 1. Another extension. manifest.json declares no `externally_connectable`,
 *    and Chrome reads that as "no web pages, but every other installed
 *    extension" -- so anything else on the profile can call sendMessage here
 *    and have this script save pages to the user's library, with the user's
 *    token, and open tabs. `sender.id` is set by the browser, not the
 *    sender, so comparing it to our own id closes that.
 * 2. An extension page of our own (the popup) that has no business asking for
 *    an import. Requiring `sender.tab` limits this to content scripts.
 * 3. A URL that isn't the sending frame's. The URL decides which article gets
 *    created and what the API is told to fetch, and it arrives in the message
 *    body rather than from the browser. Compared by origin rather than
 *    exactly, because a single-page app can push a new path between the
 *    content script reading location.href and this listener running; a
 *    different *origin* is not that.
 *
 * (1) and (2) are the checks that matter -- they are what a hostile *other*
 * extension runs into. (3) only adds anything once our own content script is
 * already compromised, which is why it is allowed to be skipped rather than
 * to fail the import: `sender.url` is the browser's own record of the
 * sending frame and is not permission-gated, but `sender.tab.url` is (it
 * needs `tabs` or a matching host permission, and this extension has neither
 * for arbitrary pages), so the fallback can legitimately be absent and must
 * not take the feature down with it.
 */
function isTrustedImportSender(sender: chrome.runtime.MessageSender, url: string): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.tab) return false;

  const senderUrl = sender.url ?? sender.tab.url;
  if (!senderUrl) return true;
  try {
    return new URL(url).origin === new URL(senderUrl).origin;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isImportRequest(message)) return false;
  if (!isTrustedImportSender(sender, message.url)) {
    // Answered rather than ignored, so our own content script never hangs on
    // a reply that isn't coming if this check is ever wrong.
    sendResponse({ ok: false, error: "save_failed", message: "Couldn't save this page." } satisfies ImportResponse);
    return false;
  }
  importPage(message.url, message.highlights)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "save_failed", message: "Couldn't save this page." }));
  return true; // keeps the message channel open for the async reply
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SAVE, title: "Save page to Booklet", contexts: ["page"] });
    chrome.contextMenus.create({
      id: MENU_LOGOUT,
      title: "Log out of Booklet",
      // Right-click on the toolbar icon itself -- the replacement for the
      // account row that used to live in the popup.
      contexts: ["action"],
      visible: false,
    });
    void syncActionBehaviour();
  });
});

chrome.runtime.onStartup.addListener(() => void syncActionBehaviour());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) void syncActionBehaviour();
});

chrome.action.onClicked.addListener((tab) => void saveTab(tab));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE) {
    await saveTab(tab);
    return;
  }
  if (info.menuItemId === MENU_LOGOUT) {
    await logout();
    // logout() clears storage, so onChanged above restores the login popup.
  }
});

// Covers the wake-ups the listeners above don't: a worker respawned by any
// other event, and the very first run after a reload during development.
void syncActionBehaviour();
