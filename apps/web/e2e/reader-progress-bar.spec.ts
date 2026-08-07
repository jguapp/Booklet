import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The persistent, Kindle-style bottom progress bar (reader-progress-bar.tsx)
 * -- % complete and time left, visible regardless of scroll position, with
 * a Settings > Reading toggle (device-prefs.ts's showProgressBar, on by
 * default).
 */

test("the progress bar shows % and time left, and can be toggled off in Settings", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/long-article.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const bar = page.locator("[data-reader-progress-bar]");
  await expect(bar.getByText("0%")).toBeVisible();
  await expect(bar.getByText(/min left$/)).toBeVisible();

  // Scroll partway through -- the bar reflects real progress and stays
  // pinned regardless of scroll position (not just visible at the top).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
  await page.waitForTimeout(300);
  const percentText = await bar.getByText(/^\d+%$/).textContent();
  expect(Number(percentText?.replace("%", ""))).toBeGreaterThan(10);

  await page.goto("/settings/reading");
  await page.getByRole("group", { name: "Progress bar" }).getByRole("button", { name: "Off", exact: true }).click();

  await page.goto("/library");
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator("[data-reader-progress-bar]")).toHaveCount(0);
});
