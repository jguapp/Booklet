import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * "Look up" a selected word, Apple Books-style -- see HighlightPopover and
 * lib/dictionary.ts. Hits the real dictionaryapi.dev (free, no key, CORS-
 * open), not mocked, since the point is verifying the real fetch -> parse ->
 * render path.
 */

async function selectWord(page: import("@playwright/test").Page) {
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el) => {
    const textNode = el.firstChild!;
    const text = textNode.textContent ?? "";
    // Skip past any leading punctuation (e.g. an opening quotation mark) --
    // the point is selecting a clean word, not literally the first character.
    const match = text.match(/[a-zA-Z]{3,}/);
    if (!match || match.index === undefined) throw new Error(`no word found in: ${text}`);
    const range = document.createRange();
    range.setStart(textNode, match.index);
    range.setEnd(textNode, match.index + match[0].length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

test("looking up a selected word shows a definition", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectWord(page);
  const lookupButton = page.getByTitle("Look up");
  await expect(lookupButton).toBeVisible();
  await lookupButton.click();

  await expect(page.getByText("Looking up…")).toBeVisible();
  // Real network round trip -- give it real time.
  await expect(page.getByText(/noun|verb|adjective/i).first()).toBeVisible({ timeout: 10_000 });
});

test("selecting more than one word doesn't offer to look it up", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el) => {
    const textNode = el.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(30, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await expect(page.getByTitle("Yellow")).toBeVisible();
  await expect(page.getByTitle("Look up")).toHaveCount(0);
});
