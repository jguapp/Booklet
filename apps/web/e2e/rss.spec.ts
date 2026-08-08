import { expect, test } from "@playwright/test";
import { FIXTURES } from "./helpers";

/**
 * RSS feed subscriptions -- local/anonymous mode, same as the rest of this
 * e2e suite.
 *
 * This used to subscribe to xkcd's live feed, on the grounds that the point
 * is exercising the real fetch -> SSRF-guarded parse pipeline
 * (rss-service.ts) rather than a stub. That reasoning still holds and is
 * preserved: the fixture server returns a genuine RSS 2.0 document that
 * rss-service.ts fetches over HTTP and parses for real -- nothing is mocked
 * inside the page.
 *
 * What changed is only that the feed is local. Three specs quietly requiring
 * the public internet made `--grep-invert @live` not actually an offline
 * switch (#167), and tied the assertions to xkcd's publishing schedule. The
 * feed's items link back at the fixture server, so "save an item" still
 * exercises real extraction against a real article.
 */

const FEED = FIXTURES.feed;

test("@live subscribing to a feed shows its items, and unsubscribing removes it", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();

  await expect(page.getByText(FEED)).toBeVisible({ timeout: 15_000 });
  const firstItem = page.locator("a[target='_blank']").first();
  await expect(firstItem).toBeVisible({ timeout: 15_000 });

  await page.getByTitle("Unsubscribe").click();
  await expect(page.getByText(/no feeds yet/i)).toBeVisible();
});

test("@live saving an item from a feed adds it to the library", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();

  const saveButton = page.getByRole("button", { name: "Save", exact: true }).first();
  await expect(saveButton).toBeVisible({ timeout: 15_000 });
  await saveButton.click();

  await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });

  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);
});

test("@live subscribing to the same feed twice is rejected", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(FEED)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill(FEED);
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(/already subscribed/i)).toBeVisible();
});

test("subscribing to something that isn't a feed shows an error", async ({ page }) => {
  await page.goto("/rss");
  await page.getByPlaceholder(/example\.com\/feed\.xml/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText(/doesn't look like a valid rss or atom feed/i)).toBeVisible({ timeout: 15_000 });
});
