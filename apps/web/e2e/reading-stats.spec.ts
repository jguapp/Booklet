import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Reading stats -- off by default, toggle-able in Settings (gates both the
 * Stats nav item and computes from real data: streaks/completion rate from
 * archivedAt, time spent from activeReadingSeconds -- see
 * packages/shared/reading-stats.ts and reader-view.tsx's time-tracking).
 */

test("the Stats nav item only shows up once the toggle is turned on", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("link", { name: "Stats" })).toHaveCount(0);

  await page.goto("/settings/library");
  await page.getByRole("group", { name: "Reading stats" }).getByRole("button", { name: "On", exact: true }).click();

  await page.goto("/library");
  await expect(page.getByRole("link", { name: "Stats" })).toBeVisible();
});

test("finishing an article updates streak, completion rate, and time spent", async ({ page }) => {
  await page.goto("/settings/library");
  await page.getByRole("group", { name: "Reading stats" }).getByRole("button", { name: "On", exact: true }).click();

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/tagging.html"); // long -- actually scrollable
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await page.waitForLoadState("networkidle");

  // Spend a little real time in the reader before finishing it, so
  // activeReadingSeconds has something to flush.
  await page.waitForTimeout(2_500);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300); // auto-archive effect

  // A client-side nav away triggers the flush-on-unmount immediately,
  // rather than waiting out the periodic flush interval.
  await page.locator('a[title="Back to library"]').click();
  await page.waitForURL(/\/library/);

  await page.goto("/stats");
  // Each stat card is a `div.rounded-md` -- unlike its ancestors (the page
  // wrapper, the grid), no other element on the page shares that class, so
  // scoping by it + the card's own label text unambiguously picks just
  // that one card instead of every ancestor div containing the same text.
  const streakCard = page.locator("div.rounded-md", { hasText: "Day streak" });
  await expect(streakCard.getByText("1", { exact: true })).toBeVisible();

  const completionCard = page.locator("div.rounded-md", { hasText: "Completion rate" });
  await expect(completionCard.getByText("100%", { exact: true })).toBeVisible();

  const finishedCard = page.locator("div.rounded-md", { hasText: "Finished" });
  await expect(finishedCard.getByText("1 / 1", { exact: true })).toBeVisible();

  const timeCard = page.locator("div.rounded-md", { hasText: "Time spent" });
  await expect(timeCard.getByText("0s", { exact: true })).toHaveCount(0);
});

test("Avg. per article shows a clean duration when the division doesn't come out even", async ({ page }) => {
  await page.goto("/settings/library");
  await page.getByRole("group", { name: "Reading stats" }).getByRole("button", { name: "On", exact: true }).click();

  // Two articles with deliberately uneven real reading times, so
  // totalReadingSeconds / 2 is very unlikely to land on a whole number --
  // this is what actually exercises the avg-per-article division (dividing
  // by 1, as the test above does, is always a no-op and can't reproduce it).
  const articles = [
    { url: "http://127.0.0.1:4321/tagging.html", waitMs: 2_200 },
    { url: "http://127.0.0.1:4321/article/metadata.html", waitMs: 3_900 },
  ];

  for (const { url, waitMs } of articles) {
    await page.goto("/library");
    await page.getByRole("button", { name: /save article/i }).click();
    await page.getByPlaceholder(/example\.com/).fill(url);
    await page.getByRole("button", { name: /^save$/i }).click();
    await waitForSaveModalToClose(page);

    await page.locator("a[href^='/reader/']").first().click();
    await expect(page).toHaveURL(/\/reader\//);
    await page.waitForLoadState("networkidle");

    await page.waitForTimeout(waitMs);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300); // auto-archive effect

    await page.locator('a[title="Back to library"]').click();
    await page.waitForURL(/\/library/);
  }

  await page.goto("/stats");
  const avgCard = page.locator("div.rounded-md", { hasText: "Avg. per article" });
  const avgValue = await avgCard.locator("p").first().textContent();
  expect(avgValue).toMatch(/^\d/); // a real value, not the "--" no-data fallback
  expect(avgValue).not.toContain(".");
});
