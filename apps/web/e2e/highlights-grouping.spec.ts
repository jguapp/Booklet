import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The Highlights page (app/(app)/highlights/page.tsx) -- grouped into one
 * card per article/book by default instead of a single flat list, so it's
 * scannable which book something came from at a glance. The flat
 * chronological view (the only thing that used to exist) is still there
 * behind a toggle, and searching bypasses grouping entirely (a search
 * result set isn't naturally "one book" the way browsing is).
 */

async function selectFirstWords(page: import("@playwright/test").Page, count: number) {
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el, count) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const text = textNode.textContent ?? "";
    const end = text.split(/\s+/).slice(0, count).join(" ").length;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(end, text.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, count);
}

async function saveAndHighlight(page: import("@playwright/test").Page, url: string, words: number) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.goto("/library");
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, words);
  await page.getByTitle("Yellow").click();
}

test("highlights page groups by book by default, and a card drills into that book's highlights", async ({
  page,
}) => {
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Readability", 4);
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Tag_(metadata)", 5);

  await page.goto("/highlights");
  // Grouped by default -- one card per book, not a flat list of highlights.
  await expect(page.getByRole("button", { name: /Readability.*1 highlight/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tag \(metadata\).*1 highlight/ })).toBeVisible();

  await page.getByRole("button", { name: /Readability/ }).click();
  await expect(page.getByRole("heading", { name: "Readability" })).toBeVisible();
  // Scoped to this book -- no per-row article link needed, it's already the
  // heading (the dropdown still lists every article as an <option>, that's
  // expected -- only a rendered article *link* in the highlight row itself
  // would mean scoping isn't actually working).
  await expect(page.getByText('"Reading difficulty" redirects here;', { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tag (metadata)" })).toHaveCount(0);

  await page.getByText("← All highlights", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Highlights" })).toBeVisible();
});

test("the 'All' toggle shows the flat chronological list across books", async ({ page }) => {
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Readability", 4);
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Tag_(metadata)", 5);

  await page.goto("/highlights");
  await page.getByRole("group", { name: "Highlights view" }).getByRole("button", { name: "All", exact: true }).click();

  // Flat list -- both highlights visible at once, each with its own article link.
  await expect(page.getByRole("link", { name: "Readability" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tag (metadata)" })).toBeVisible();
});

test("with highlights from only one book, the flat list shows directly -- no pointless single-card group", async ({
  page,
}) => {
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Readability", 4);

  await page.goto("/highlights");
  // A single-card "group" would just hide the one book's highlights behind
  // an extra click for no benefit -- go straight to the flat list instead.
  await expect(page.getByRole("button", { name: /Readability.*1 highlight/ })).toHaveCount(0);
  await expect(page.getByText('"Reading difficulty" redirects here;', { exact: false })).toBeVisible();
  // Nothing to toggle between when there's only one book either.
  await expect(page.getByRole("group", { name: "Highlights view" })).toHaveCount(0);
});

test("searching bypasses grouping and shows matching highlights directly", async ({ page }) => {
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Readability", 4);
  await saveAndHighlight(page, "https://en.wikipedia.org/wiki/Tag_(metadata)", 5);

  await page.goto("/highlights");
  await expect(page.getByRole("button", { name: /Readability/ })).toBeVisible();

  await page.getByPlaceholder("Search highlights, notes…").fill("reading difficulty");
  await expect(page.getByText('"Reading difficulty" redirects here;', { exact: false })).toBeVisible();
  // No grouped card, and no view-mode toggle while a search is active.
  await expect(page.getByRole("button", { name: /Readability.*1 highlight/ })).toHaveCount(0);
});
