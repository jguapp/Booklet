import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Does turning PDF/EPUB pages and then leaving the reader via a real in-app
 * (client-side) navigation -- not a reload -- and coming back land you
 * where you left off? tags-search-progress.spec.ts already covers the
 * HTML/scroll-fraction case; these are the PDF page-number and EPUB CFI
 * cases. The EPUB one caught a real bug: a relocate landing while
 * book.locations.generate() is still in flight has its percentage silently
 * dropped forever (see epub-reader.tsx's locationsReady handling).
 */

const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");
const TWO_CHAPTER_EPUB = path.join(process.cwd(), "e2e", "fixtures", "two-chapter.epub");

async function leaveAndReturnToReader(page: import("@playwright/test").Page) {
  await page.locator('a[title="Back to library"]').click();
  await page.waitForURL(/\/library/);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
}

test("PDF page position survives leaving the reader and coming back, even navigating away immediately", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(SAMPLE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await expect(page.getByText(/Page 1 of 2/)).toBeVisible({ timeout: 10_000 });
  await page.getByText("Next →", { exact: true }).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();

  // No artificial wait -- leave the instant the page turn lands, which is
  // closer to how someone actually flips a page and immediately taps back.
  await leaveAndReturnToReader(page);
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible({ timeout: 10_000 });
});

test("EPUB location survives leaving the reader and coming back", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(TWO_CHAPTER_EPUB);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const iframe = page.frameLocator("[data-epub-reader] iframe").first();
  await expect(iframe.locator("h1")).toHaveText("Chapter One", { timeout: 10_000 });
  await page.getByText("Next →", { exact: true }).click();
  await expect(iframe.locator("h1")).toHaveText("Chapter Two", { timeout: 10_000 });

  // epub.js reports the new location asynchronously (its own internal
  // requestAnimationFrame-deferred queue, independent of when the section's
  // content actually finishes rendering) -- give it a moment to land before
  // leaving, same as a real reader who looks at the new page before tapping
  // back rather than doing both within the same animation frame.
  await page.waitForTimeout(150);
  await leaveAndReturnToReader(page);
  await expect(iframe.locator("h1")).toHaveText("Chapter Two", { timeout: 10_000 });
});
