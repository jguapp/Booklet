import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Regression coverage for a real bug: reader-view.tsx used to attach its
 * window-scroll-fraction progress listener unconditionally, regardless of
 * which reader (HTML/PDF/EPUB) was actually mounted. Any incidental window
 * scroll while a PDF or EPUB reader was active -- not just deliberate
 * scrolling, just the page container being taller than the viewport --
 * would overwrite that reader's own correct page-turn/relocate-derived
 * progress with a value computed from unrelated document scroll geometry.
 * That's what caused an EPUB to get auto-archived after only a couple of
 * pages (a stray scroll pushed the shared progress near 1.0) and a PDF's
 * progress to never reliably reflect real page position (a stray scroll
 * kept overwriting it back down). Fixed by only attaching the window-scroll
 * listener for the plain-HTML reader path.
 */

const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");
const TWO_CHAPTER_EPUB = path.join(process.cwd(), "e2e", "fixtures", "two-chapter.epub");

/** Makes the document artificially tall and scrolls to roughly
 * `targetFraction` of it, then fires a real scroll event -- exactly the
 * shape of scroll the old unconditional window-scroll listener used to
 * misread as real reading progress, regardless of which reader was
 * actually mounted or how far into the content it really was. A fraction
 * near 1 reproduces "scrolling fake-completes it"; a fraction near 0
 * reproduces "scrolling clobbers real progress back down." */
async function fireSpuriousScroll(page: import("@playwright/test").Page, targetFraction: number) {
  await page.evaluate((fraction) => {
    const spacer = document.createElement("div");
    spacer.style.height = "100000px";
    spacer.setAttribute("data-test-spacer", "true");
    document.body.appendChild(spacer);
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, scrollable * fraction);
    window.dispatchEvent(new Event("scroll"));
  }, targetFraction);
  await page.waitForTimeout(200);
}

async function flushByLeavingAndReturning(page: import("@playwright/test").Page) {
  await page.locator('a[title="Back to library"]').click();
  await page.waitForURL(/\/library/);
  await page.getByRole("button", { name: "All", exact: true }).click();
}

test("a stray window scroll while reading an EPUB doesn't fake-complete it into being archived", async ({
  page,
}) => {
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

  // Never advance past Chapter One -- only a spurious near-bottom scroll
  // happens here, which used to be misread as "almost done."
  await fireSpuriousScroll(page, 0.99);

  await flushByLeavingAndReturning(page);
  const card = page.locator("a[href^='/reader/']").first();
  await expect(card.getByText("Archived", { exact: true })).toHaveCount(0);
});

test("a stray window scroll while on a PDF's first page doesn't fake-complete it into being archived", async ({
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

  // Never actually turn the page -- only a spurious near-bottom scroll
  // happens here. Under the bug, this alone got saved as ~99% progress
  // (real PDF progress is page-number-based, not scroll-based) and tripped
  // auto-archive, even though page 2 was never viewed. Give the (async)
  // auto-archive effect + IndexedDB write real time to land before
  // navigating away, rather than racing it.
  await fireSpuriousScroll(page, 0.99);
  await page.waitForTimeout(1000);

  await flushByLeavingAndReturning(page);
  const card = page.locator("a[href^='/reader/']").first();
  await expect(card.getByText("Archived", { exact: true })).toHaveCount(0);
});
