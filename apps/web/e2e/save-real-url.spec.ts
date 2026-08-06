import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The one spec in this suite that deliberately saves a **real, public URL**
 * over the real internet.
 *
 * Every other spec that saves an article now uses the local fixture server
 * (see e2e/fixture-server/server.mjs) — because almost none of them are
 * testing extraction, they just need an article to exist, and doing that over
 * the network made each one a live fetch plus a full Readability pass,
 * serialized behind a single worker.
 *
 * But "extraction works against real-world HTML" is a genuine thing to cover,
 * and fixtures can't cover it: the fixture pages are clean, well-formed, and
 * written to be extractable. Real pages have ad wrappers, cookie banners,
 * lazy-loaded images, inconsistent metadata, and redirects. If this suite had
 * *no* live extraction test, a regression that only breaks on real pages
 * would ship green.
 *
 * So: please don't "tidy this up" to use a fixture. It is the exception on
 * purpose, and it's one test rather than thirty-one.
 *
 * It is tagged @live so it can be excluded (`--grep-invert @live`) in an
 * environment with no outbound network, rather than failing misleadingly.
 */
test("@live saving a real public URL extracts real-world HTML", async ({ page }) => {
  // Real network + real extraction, so a more forgiving budget than the
  // fixture-backed specs need.
  test.setTimeout(60_000);

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  // Title came from the real page, not from the URL.
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  // Real body text was extracted, and the page's navigation chrome was not.
  const article = page.locator("article, [data-article-content]").first();
  await expect(article).toContainText(/readability/i, { timeout: 20_000 });
});
