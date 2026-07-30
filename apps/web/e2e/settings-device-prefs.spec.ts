import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Default text size and read-aloud speed -- device-local reader
 * preferences (lib/reader/device-prefs.ts), set from Settings, applied to
 * a newly-opened reader. Not account-synced, so this only needs local/
 * anonymous mode to exercise for real.
 */

test("changing the default text size in Settings applies it to a newly-opened article", async ({ page }) => {
  await page.goto("/settings/reading");
  await page.getByRole("group", { name: "Default text size" }).getByRole("button", { name: "Large", exact: true }).click();

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const content = page.locator("[data-article-content]");
  await expect(content).toBeVisible({ timeout: 10_000 });
  await expect(content).toHaveCSS("font-size", "21px"); // SIZE_STYLE.lg, see article-content.tsx

  // Persists across a reload of Settings itself, not just applied once.
  await page.goto("/settings/reading");
  await expect(
    page.getByRole("group", { name: "Default text size" }).getByRole("button", { name: "Large", exact: true }),
  ).toHaveClass(/bg-surface\b/);
});
