import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Recap -- a time-boxed slice of the same data Stats computes (see
 * computeRecap, packages/shared/recap.ts), pushed as a "wrapped"-style
 * summary rather than something you have to remember to check.
 */

test("finishing an article shows up in this week's Recap", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300); // auto-archive effect

  await page.goto("/recap");
  await expect(page.getByRole("heading", { name: "Your Recap" })).toBeVisible();
  await expect(page.getByText("This week", { exact: true })).toBeVisible();

  const savedStat = page.locator("div.text-center", { hasText: "Saved" });
  await expect(savedStat.getByText("1", { exact: true })).toBeVisible();
  const finishedStat = page.locator("div.text-center", { hasText: "Finished" });
  await expect(finishedStat.getByText("1", { exact: true })).toBeVisible();

  // Switching to "This month" still includes it (a week-old save is
  // trivially within a month too) -- proves the period toggle actually
  // recomputes rather than being decorative.
  await page.getByRole("button", { name: "This month", exact: true }).click();
  await expect(finishedStat.getByText("1", { exact: true })).toBeVisible();
});

test("Stats links to Recap and back", async ({ page }) => {
  await page.goto("/stats");
  await page.getByRole("link", { name: /view your recap/i }).click();
  await expect(page).toHaveURL(/\/recap/);
  await page.getByRole("link", { name: /full stats/i }).click();
  await expect(page).toHaveURL(/\/stats/);
});
