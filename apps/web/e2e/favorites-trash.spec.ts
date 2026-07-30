import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Favorites (star toggle + /favorites) and Trash (soft-delete + /trash,
 * restore, delete forever, empty trash) -- local/anonymous mode, same as
 * the rest of this e2e suite.
 */

async function saveUrl(page: import("@playwright/test").Page, url: string) {
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("favoriting an article surfaces it on the Favorites page, unfavoriting removes it", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Readability");

  const card = page.locator("a[href^='/reader/']").first();
  await expect(card).toBeVisible();
  await card.getByTitle("Add to favorites").click();

  await page.goto("/favorites");
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);

  await page.locator("a[href^='/reader/']").first().getByTitle("Remove from favorites").click();
  await expect(page.getByText(/nothing favorited yet/i)).toBeVisible();
});

test("deleting an article moves it to Trash, where it can be restored or deleted forever", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Full-text_search");

  const card = page.locator("a[href^='/reader/']").first();
  const title = await card.locator("h3").textContent();
  await card.getByTitle("Move to trash").click();
  await expect(card).toHaveCount(0);

  await page.goto("/trash");
  await expect(page.getByText(title!.trim())).toBeVisible();

  // Restore brings it back to the library and out of Trash. The restored
  // article is UNREAD, which is the library's default tab.
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await page.goto("/library");
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);

  // Delete forever needs a real confirm, and is actually permanent.
  await page.locator("a[href^='/reader/']").first().getByTitle("Move to trash").click();
  await page.goto("/trash");
  await page.getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await page.goto("/library");
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(0);
});

test("empty trash clears everything at once, behind a confirm", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Tag_(metadata)");
  await page.locator("a[href^='/reader/']").first().getByTitle("Move to trash").click();

  await page.goto("/trash");
  await expect(page.locator("button", { hasText: "Restore" })).toHaveCount(1);
  await page.getByRole("button", { name: "Empty trash" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Empty trash", exact: true }).click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
});
