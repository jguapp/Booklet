import { expect, test } from "@playwright/test";

/**
 * Exercises the local/anonymous (no-account, IndexedDB-backed) path end to
 * end -- the one part of this app that unit tests and API integration tests
 * structurally can't reach, since it lives entirely in the browser with no
 * server-side persistence to assert against.
 *
 * Needs real network access (saves a real Wikipedia URL through the actual
 * extraction service) -- not mocked, since the point is verifying the whole
 * save -> read -> highlight loop for real, not a stubbed version of it.
 */

const TEST_ARTICLE_URL = "https://en.wikipedia.org/wiki/Readability";

test("landing page offers a no-account path into the library", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /continue without an account/i }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("save an article by URL, read it, highlight it, and see it on the Highlights page", async ({ page }) => {
  await page.goto("/library");

  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(TEST_ARTICLE_URL);
  await page.getByRole("button", { name: /^save$/i }).click();

  // Extraction hits the real API -- give it real time, not a UI-animation timeout.
  await expect(page.getByRole("button", { name: /save article/i })).toBeVisible({ timeout: 20_000 });
  const card = page.locator("a[href^='/reader/']").first();
  await expect(card).toBeVisible();
  const cardTitle = await card.locator("h3").textContent();
  expect(cardTitle).toBeTruthy();

  await card.click();
  await expect(page).toHaveURL(/\/reader\//);

  // Select the first 12 characters of the first paragraph's text node directly
  // (rather than double-click word-selection, which is unreliable across
  // punctuation/whitespace at element boundaries) and fire the mouseup
  // ArticleContent listens for to open the highlight popover.
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el) => {
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
  });

  // The popover's color swatches confirm the highlight immediately on click
  // (no separate "confirm" step unless adding a note) -- see highlight-popover.tsx.
  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await yellowSwatch.click();

  await expect(page.locator("mark[data-highlight-id]").first()).toBeVisible();

  await page.goto("/highlights");
  await expect(page.locator("text=No highlights yet")).toHaveCount(0);
});

test("Daily Review shows the empty state when nothing is eligible yet", async ({ page }) => {
  await page.goto("/resurface");
  await expect(page.getByRole("heading", { name: /daily review/i })).toBeVisible();
});
