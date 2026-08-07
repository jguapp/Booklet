import { expect, test } from "@playwright/test";

/**
 * RSS feed subscriptions -- local/anonymous mode, same as the rest of this
 * e2e suite. Uses a real, long-stable public feed (xkcd's RSS) rather than
 * a fixture, since the point is exercising the real fetch -> SSRF-guarded
 * parse pipeline (rss-service.ts), not a stub -- same reasoning as the rest
 * of the suite using real Wikipedia saves.
 */

const XKCD_FEED = "https://xkcd.com/rss.xml";

test("subscribing to a feed shows its items, and unsubscribing removes it", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(XKCD_FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();

  await expect(page.getByText(XKCD_FEED)).toBeVisible({ timeout: 15_000 });
  const firstItem = page.locator("a[target='_blank']").first();
  await expect(firstItem).toBeVisible({ timeout: 15_000 });

  await page.getByTitle("Unsubscribe").click();
  await expect(page.getByText(/no feeds yet/i)).toBeVisible();
});

test("saving an item from a feed adds it to the library", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(XKCD_FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();

  const saveButton = page.getByRole("button", { name: "Save", exact: true }).first();
  await expect(saveButton).toBeVisible({ timeout: 15_000 });
  await saveButton.click();

  await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });

  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);
});

test("subscribing to the same feed twice is rejected", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(XKCD_FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(XKCD_FEED)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(XKCD_FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(/already subscribed/i)).toBeVisible();
});

test("subscribing to something that isn't a feed shows an error", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(/doesn't look like a valid rss or atom feed/i)).toBeVisible({ timeout: 15_000 });
});
