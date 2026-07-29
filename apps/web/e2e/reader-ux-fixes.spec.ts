import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Regression coverage for two reader UX fixes: the highlight popover used to
 * be positioned as if its nearest positioned ancestor were the document
 * root, but in the HTML article reader it's actually a locally-offset
 * `position: relative` wrapper nested deep in the page -- landing the
 * popover far from the real selection (see highlight-popover.tsx). And
 * nothing used to automatically mark an article as read on reaching the end
 * (reader-view.tsx) -- only the manual Unread/Reading/Archived tabs did.
 */

async function saveUrl(page: import("@playwright/test").Page, url: string) {
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("the highlight popover appears right above the selected text, not offset by the page's own layout", async ({
  page,
}) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Readability");

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  const selectionTop = await paragraph.evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const range = document.createRange();
    const length = Math.min(12, textNode.textContent?.length ?? 0);
    range.setStart(textNode, 0);
    range.setEnd(textNode, length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.getBoundingClientRect().top;
  });

  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  const popover = page.locator("div.fixed", { has: yellowSwatch });
  const popoverBox = await popover.boundingBox();
  expect(popoverBox).not.toBeNull();

  // The popover sits just above the selection -- comfortably within 100px
  // when positioned correctly. The bug this guards against offset it by
  // everything above the article content (toolbar, title, meta, status
  // tabs, tag editor), which is several hundred px.
  expect(Math.abs(popoverBox!.y + popoverBox!.height - selectionTop)).toBeLessThan(100);
});

test("reaching the end of an article automatically archives it", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Tag_(metadata)"); // long article -- actually scrollable

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);

  // The library defaults to the "Reading" tab -- "Archived" won't show
  // there by design, so switch to "All" to see the now-archived card.
  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  const card = page.locator("a[href^='/reader/']").first();
  await expect(card.getByText("Archived", { exact: true })).toBeVisible();
});
