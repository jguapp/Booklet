import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

// playwright.config.ts's testDir is e2e/, and Playwright always resolves
// process.cwd() to the package root (apps/web) regardless of how the test
// command was invoked -- so this is stable without needing import.meta.
const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");
const SAMPLE_EPUB_NO_COVER = path.join(process.cwd(), "e2e", "fixtures", "sample.epub");
// A manifest item with properties="cover-image" plus a tiny embedded PNG --
// sample.epub (used elsewhere in this suite) has no images in it at all, so
// it can't exercise the actual cover-found path, only the fallback.
const SAMPLE_EPUB_WITH_COVER = path.join(process.cwd(), "e2e", "fixtures", "with-cover.epub");

/**
 * Library card thumbnails (article-card.tsx) -- og:image for HTML, a
 * rendered first page for PDF, the declared cover for EPUB. Needs real
 * network access for the HTML case (a real page's real <meta> tags), not
 * mocked -- same rationale as the rest of this suite's network-touching
 * tests.
 */

async function saveByFile(page: import("@playwright/test").Page, filePath: string) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(filePath);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("an HTML article with an og:image shows it as its library card thumbnail", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  // The tagging fixture serves <meta property="og:image"> (see
  // e2e/fixture-server/server.mjs) so this exercises the real
  // og:image -> inlined data: URI thumbnail path without a network fetch.
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/tagging.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await expect(page.locator("img[src^='data:image']")).toBeVisible();
});

test("uploading a PDF shows its first page as a thumbnail", async ({ page }) => {
  await saveByFile(page, SAMPLE_PDF);

  await expect(page.locator("img[src^='data:image']")).toBeVisible();
});

test("uploading an EPUB with a declared cover shows it as a thumbnail", async ({ page }) => {
  await saveByFile(page, SAMPLE_EPUB_WITH_COVER);

  await expect(page.locator("img[src^='data:image']")).toBeVisible();
});

test("an article with no extractable cover falls back to the plain card, not a broken image", async ({ page }) => {
  await saveByFile(page, SAMPLE_EPUB_NO_COVER);

  await expect(page.getByText("Sample Test Book")).toBeVisible();
  await expect(page.locator("img[src^='data:image']")).toHaveCount(0);
});
