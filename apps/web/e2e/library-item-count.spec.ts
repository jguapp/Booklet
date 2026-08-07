import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * A small count badge (library/page.tsx) showing how many articles are in
 * the currently-selected view -- previously there was no way to tell at a
 * glance without counting cards by eye.
 */

async function saveUrl(page: import("@playwright/test").Page, url: string) {
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("the item count reflects the current tab and updates as articles move between tabs", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("0 articles")).toBeVisible();

  await saveUrl(page, "http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("1 article", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("1 article", { exact: true })).toBeVisible();

  // Archiving moves it out of the Unread count and into Archived's.
  await page.locator("a[href^='/reader/']").first().click();
  await page.waitForURL(/\/reader\//);
  await page.getByRole("button", { name: "Archived", exact: true }).click(); // reader-view.tsx's own status tabs

  await page.goto("/library");
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("0 articles")).toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByText("1 article", { exact: true })).toBeVisible();
});
