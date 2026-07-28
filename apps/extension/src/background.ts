import { getSession, saveArticle } from "./api";

const MENU_ID = "booklet-save-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Save page to Booklet", contexts: ["page"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.url) return;

  const session = await getSession();
  if (!session) {
    chrome.action.openPopup().catch(() => undefined);
    return;
  }

  try {
    const result = await saveArticle(tab.url);
    chrome.action.setBadgeText({ text: result.extractionStatus === "FAILED" ? "!" : "✓", tabId: tab.id });
  } catch {
    chrome.action.setBadgeText({ text: "!", tabId: tab.id });
  } finally {
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 3000);
  }
});
