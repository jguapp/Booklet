import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * "More from your library" -- computed client-side from shared tags/title
 * overlap (packages/shared/related-articles.ts), shown once the reader
 * nears the end of an article, same trigger as the existing auto-archive
 * effect. No semantic-search/embeddings infra exists yet, so this is
 * deliberately the cheap tag-overlap stand-in, not true "similar content."
 */

async function saveAndTag(page: import("@playwright/test").Page, url: string, tag: string) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const link = page.locator("a[href^='/reader/']").first();
  await link.click();
  await page.waitForURL(/\/reader\//);
  const articleId = page.url().split("/reader/")[1];

  const tagInput = page.getByPlaceholder(/add a tag/i);
  await tagInput.waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await tagInput.fill(tag);
  await tagInput.press("Enter");
  await expect(page.locator('button[title^="Remove"]')).toContainText(tag);

  return articleId;
}

test("finishing an article surfaces a tag-related one under 'More from your library'", async ({ page }) => {
  await saveAndTag(page, "http://127.0.0.1:4321/readability.html", "shared-tag-test");
  const secondId = await saveAndTag(page, "http://127.0.0.1:4321/tagging.html", "shared-tag-test");

  // Re-open the first article (still UNREAD/READING) and read it to the end
  // -- go via Library rather than browser back, since back could resume a
  // stale scroll position instead of a fresh top-of-page load.
  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByText("Readability", { exact: true }).first().click();
  await page.waitForURL(/\/reader\//);
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const relatedSection = page.getByText("More from your library");
  await expect(relatedSection).toBeVisible({ timeout: 10_000 });
  const relatedLink = page.locator(`a[href='/reader/${secondId}']`);
  await expect(relatedLink).toBeVisible();
  await expect(relatedLink).toContainText("Tag");

  await relatedLink.click();
  await expect(page).toHaveURL(new RegExp(`/reader/${secondId}`));
});
