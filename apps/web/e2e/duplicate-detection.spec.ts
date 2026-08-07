import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Canonical-URL duplicate detection (packages/shared/url-canonicalize.ts)
 * -- exact-string matching on `url` alone (the pre-existing check) misses
 * a tracking-param variant of a URL already saved. The duplicate check
 * happens before extraction is attempted in both save paths, so this
 * doesn't need the decorated URL to actually be fetchable for the test to
 * prove rejection.
 */

test("saving a tracking-param variant of an already-saved URL is rejected as a duplicate", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.getByRole("button", { name: /save article/i }).click();
  await page
    .getByPlaceholder(/example\.com/)
    .fill("http://127.0.0.1:4321/readability.html?utm_source=twitter&utm_medium=social");
  await page.getByRole("button", { name: /^save$/i }).click();

  await expect(page.getByText(/already saved this article/i)).toBeVisible({ timeout: 10_000 });

  // The duplicate wasn't actually saved a second time.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);
});
