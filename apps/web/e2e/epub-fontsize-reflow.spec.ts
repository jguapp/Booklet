import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Regression coverage for a real bug: epub.js's `themes.fontSize()` only
 * sets a CSS property on the currently-rendered content -- it never tells
 * the paginated-layout manager to recompute column widths/page counts for
 * the new size. Confirmed by hand: increasing text size mid-read left the
 * "Page X of Y" total completely unchanged (it should increase -- less
 * text fits per page at a larger size), and paging forward from a font
 * size increased mid-book could no longer reach content that used to be
 * later in the same section, since Next/Prev still walked the stale,
 * pre-resize page count. Fixed in epub-reader.tsx by tracking the current
 * CFI on every "relocated" event and re-`display()`-ing it right after a
 * font-size change, forcing epub.js to fully re-layout at the new size.
 *
 * `long-chapter.epub` (e2e/fixtures/) is a single very long chapter (120+
 * filler paragraphs) with a marker string at the very start and another at
 * the very end -- long enough to need multiple pages at any font size,
 * which the built-in `two-chapter.epub`/`sample.epub` fixtures (a
 * paragraph or two each) are too short to ever do.
 */

const LONG_CHAPTER_EPUB = path.join(process.cwd(), "e2e", "fixtures", "long-chapter.epub");

test("increasing text size mid-read re-paginates instead of leaving content unreachable", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(LONG_CHAPTER_EPUB);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const iframe = page.frameLocator("[data-epub-reader] iframe").first();
  await expect(iframe.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Get into the middle of the chapter, not page 1, before changing size --
  // matches someone increasing text size partway through reading.
  for (let i = 0; i < 5; i++) {
    await page.getByText("Next →", { exact: true }).click();
    await page.waitForTimeout(150);
  }

  const pageLabel = page.locator("span", { hasText: /^Page \d+ of \d+$/ });
  const totalBefore = Number((await pageLabel.textContent())?.match(/of (\d+)/)?.[1]);
  expect(totalBefore).toBeGreaterThan(0);

  // Max out the text size via the reader toolbar itself, the same control
  // used mid-read (not the Settings page).
  for (let i = 0; i < 3; i++) {
    if (await page.getByTitle("Larger text").isDisabled()) break;
    await page.getByTitle("Larger text").click();
    await page.waitForTimeout(400);
  }

  // The bug: this total used to never change, no matter the font size.
  const totalAfter = Number((await pageLabel.textContent())?.match(/of (\d+)/)?.[1]);
  expect(totalAfter).toBeGreaterThan(totalBefore);

  // And every bit of the chapter -- including whatever the old, larger
  // font would have overflowed into an unreachable column -- must still be
  // reachable by paging forward from here.
  let reachedEnd = false;
  for (let i = 0; i < 150; i++) {
    const bodyText = await iframe.locator("body").innerText().catch(() => "");
    if (bodyText.includes("END_MARKER_TEXT")) {
      reachedEnd = true;
      break;
    }
    const nextBtn = page.getByText("Next →", { exact: true });
    if (!(await nextBtn.isEnabled().catch(() => false))) break;
    await nextBtn.click();
    await page.waitForTimeout(100);
  }
  expect(reachedEnd).toBe(true);
});
