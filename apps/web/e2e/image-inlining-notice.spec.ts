import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The reader-only notice shown when some of an HTML article's images
 * couldn't be inlined at save time (too large, too many, or the fetch just
 * failed -- see extraction-service.ts's inlineImages, unit-tested there for
 * the actual skip-counting logic). Unlike the rest of this suite, this
 * mocks the extraction response instead of relying on a real page's images
 * actually missing the inlining caps -- there's no reliable, non-flaky way
 * to make a real external image fail to inline on demand, and the caps
 * themselves are already covered by extraction-service.test.ts. This is
 * only testing that reader-view.tsx renders the notice correctly for a
 * given skippedImageCount.
 */
async function mockExtract(page: import("@playwright/test").Page, skippedImageCount: number) {
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: `Image Inlining Test (${skippedImageCount})`,
        author: null,
        siteName: null,
        excerpt: null,
        html: "<p>Some article text.</p>",
        text: "Some article text.",
        readingTimeEstimate: 1,
        skippedImageCount,
      }),
    });
  });
}

// url must be unique per call within a test -- reused across saves in the
// same test, the local-mode "already saved" duplicate check would reject
// the second one.
async function saveAndOpen(page: import("@playwright/test").Page, url: string, skippedImageCount: number) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.goto("/library");
  // The card's <a> wraps a lot more than the title (status badge, action
  // buttons, metadata), so its accessible name isn't just the title --
  // click the heading itself instead. Exact match: earlier saves in the
  // same test (a different skippedImageCount, hence a different title) are
  // still in the library.
  await page.getByRole("heading", { name: `Image Inlining Test (${skippedImageCount})`, exact: true }).click();
  await expect(page).toHaveURL(/\/reader\//);
}

test("shows a pluralized notice when more than one image was skipped", async ({ page }) => {
  await mockExtract(page, 2);
  await saveAndOpen(page, "https://example.com/image-inlining-plural", 2);

  await expect(
    page.getByText("2 images were too large to save and are still loading from the original site."),
  ).toBeVisible();
});

test("shows singular copy for exactly one skipped image, and no notice when none were", async ({ page }) => {
  await mockExtract(page, 0);
  await saveAndOpen(page, "https://example.com/image-inlining-zero", 0);
  await expect(page.getByText(/too large to save/)).toHaveCount(0);

  await mockExtract(page, 1);
  await saveAndOpen(page, "https://example.com/image-inlining-one", 1);
  await expect(
    page.getByText("1 image was too large to save and is still loading from the original site."),
  ).toBeVisible();
});
