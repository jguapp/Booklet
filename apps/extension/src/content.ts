import { getPageHighlights, setPageHighlights, type StoredHighlight } from "./highlight-store";
import { anchorFromRange, buildTextMap, findAnchor, paintRange, unpaint } from "./text-anchor";
import type { ImportRequest, ImportResponse } from "./messages";

const MARK_CLASS = "booklet-web-highlight";

let highlights: StoredHighlight[] = [];
let shadow: ShadowRoot;
let toolbar: HTMLElement;
let bar: HTMLElement;
let barCount: HTMLElement;
let barStatus: HTMLElement;
let barButton: HTMLButtonElement;
let pendingRange: Range | null = null;
let selectedMarkId: string | null = null;

/**
 * The page's own CSS is hostile by default -- a site with
 * `div { display: none }`-style resets, aggressive `!important` rules, or a
 * z-index war will happily eat an injected toolbar. A shadow root is the only
 * way to get a UI that renders the same everywhere without shipping a
 * defensive stylesheet per site.
 */
function buildUi(): void {
  const host = document.createElement("div");
  host.setAttribute("data-booklet-ui", "");
  // Marked so buildTextMap() skips it: our own labels must never become part
  // of the page text a highlight quotes context from.
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .toolbar, .bar {
      position: fixed;
      z-index: 2147483647;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #211F1A;
      color: #FBFAF6;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
      display: none;
      align-items: center;
    }
    .toolbar { padding: 4px; gap: 2px; }
    .bar {
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 8px 8px 14px;
      gap: 12px;
      font-size: 13px;
    }
    .toolbar[data-open], .bar[data-open] { display: flex; }
    button {
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      padding: 7px 11px;
      cursor: pointer;
      background: transparent;
      color: #FBFAF6;
    }
    button:hover { background: rgba(251, 250, 246, 0.14); }
    button.primary { background: #1F6F6B; }
    button.primary:hover { background: #2A8A85; }
    button:disabled { opacity: 0.55; cursor: default; }
    .count { font-weight: 600; white-space: nowrap; }
    .status { font-size: 12px; opacity: 0.75; white-space: nowrap; }
    .status[data-error] { color: #FFB4A2; opacity: 1; }
  `;

  toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  bar = document.createElement("div");
  bar.className = "bar";
  barCount = document.createElement("span");
  barCount.className = "count";
  barStatus = document.createElement("span");
  barStatus.className = "status";
  barButton = document.createElement("button");
  barButton.className = "primary";
  barButton.textContent = "Open in Booklet";
  barButton.addEventListener("click", () => void importPage());
  bar.append(barCount, barStatus, barButton);

  shadow.append(style, toolbar, bar);

  const markStyle = document.createElement("style");
  // Marks live in the page, not the shadow root, so this one rule has to go
  // in the document. Kept to background/cursor only -- inheriting the page's
  // own text colour is what makes a highlight look native rather than pasted on.
  markStyle.textContent = `
    mark.${MARK_CLASS} {
      background-color: rgba(255, 206, 84, 0.5);
      color: inherit;
      border-radius: 2px;
      cursor: pointer;
    }
  `;
  document.head?.appendChild(markStyle);
}

function showToolbar(x: number, y: number, buttons: { label: string; onClick: () => void }[]): void {
  toolbar.replaceChildren(
    ...buttons.map(({ label, onClick }) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("mousedown", (event) => {
        // mousedown, not click: clicking would collapse the selection we're
        // about to read before the handler ever runs.
        event.preventDefault();
        onClick();
      });
      return button;
    }),
  );
  toolbar.setAttribute("data-open", "");
  const width = toolbar.offsetWidth || 90;
  toolbar.style.left = `${Math.max(8, Math.min(x - width / 2, window.innerWidth - width - 8))}px`;
  toolbar.style.top = `${Math.max(8, y - toolbar.offsetHeight - 8)}px`;
}

function hideToolbar(): void {
  toolbar.removeAttribute("data-open");
  pendingRange = null;
  selectedMarkId = null;
}

function renderBar(): void {
  if (highlights.length === 0) {
    bar.removeAttribute("data-open");
    return;
  }
  bar.setAttribute("data-open", "");
  barCount.textContent = `${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`;
}

function setStatus(message: string, isError = false): void {
  barStatus.textContent = message;
  if (isError) barStatus.setAttribute("data-error", "");
  else barStatus.removeAttribute("data-error");
}

async function addHighlight(range: Range): Promise<void> {
  const anchor = anchorFromRange(buildTextMap(document.body), range);
  if (!anchor) return;

  const highlight: StoredHighlight = { ...anchor, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  paintRange(range, highlight.id, MARK_CLASS);
  window.getSelection()?.removeAllRanges();

  highlights = [...highlights, highlight];
  await setPageHighlights(location.href, highlights);
  setStatus("");
  renderBar();
}

async function removeHighlight(id: string): Promise<void> {
  unpaint(id);
  highlights = highlights.filter((h) => h.id !== id);
  await setPageHighlights(location.href, highlights);
  renderBar();
}

async function importPage(): Promise<void> {
  barButton.disabled = true;
  setStatus("Saving…");

  try {
    const request: ImportRequest = { type: "booklet-import-page", url: location.href, highlights };
    const response = (await chrome.runtime.sendMessage(request)) as ImportResponse | undefined;

    if (!response) {
      setStatus("Couldn't reach Booklet.", true);
      return;
    }
    if (!response.ok) {
      setStatus(response.message, true);
      return;
    }

    // Only now is it safe to drop the local copy -- clearing before the
    // import is confirmed would silently lose highlights on any failure.
    for (const highlight of highlights) unpaint(highlight.id);
    highlights = [];
    await setPageHighlights(location.href, highlights);
    renderBar();
  } catch {
    setStatus("Couldn't reach Booklet.", true);
  } finally {
    barButton.disabled = false;
  }
}

function onSelectionSettled(): void {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    if (!selectedMarkId) hideToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  // A selection inside our own UI isn't a page selection.
  if (shadow.host.contains(range.commonAncestorContainer)) return;

  pendingRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  showToolbar(rect.left + rect.width / 2, rect.top, [
    {
      label: "Highlight",
      onClick: () => {
        const target = pendingRange;
        hideToolbar();
        if (target) void addHighlight(target);
      },
    },
  ]);
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const mark = target?.closest?.(`mark.${MARK_CLASS}`) as HTMLElement | undefined;

  if (!mark) {
    if (selectedMarkId) hideToolbar();
    return;
  }

  const id = mark.dataset.bookletHighlightId;
  if (!id) return;

  selectedMarkId = id;
  const rect = mark.getBoundingClientRect();
  showToolbar(rect.left + rect.width / 2, rect.top, [
    {
      label: "Remove",
      onClick: () => {
        hideToolbar();
        void removeHighlight(id);
      },
    },
  ]);
}

async function restore(): Promise<void> {
  highlights = await getPageHighlights(location.href);
  if (highlights.length === 0) return;

  const map = buildTextMap(document.body);
  const stillResolvable: StoredHighlight[] = [];
  for (const highlight of highlights) {
    const range = findAnchor(map, highlight);
    // A highlight that no longer resolves is kept, not dropped: the page may
    // simply not have finished rendering, and it still imports fine -- the
    // server re-anchors against extractedText independently of whether we
    // could paint it here.
    if (range) paintRange(range, highlight.id, MARK_CLASS);
    stillResolvable.push(highlight);
  }
  highlights = stillResolvable;
  renderBar();
}

function init(): void {
  // Only the top-level document: an ad iframe is not something anyone wants
  // a highlighting UI in, and each frame would inject its own toolbar.
  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol)) return;

  buildUi();
  document.addEventListener("mouseup", () => setTimeout(onSelectionSettled, 0));
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideToolbar();
  });

  void restore();
}

try {
  init();
} catch (err) {
  // A content script runs on every page on the internet; a crash here must
  // never take the page down with it.
  console.error("[booklet] content script failed to start", err);
}
