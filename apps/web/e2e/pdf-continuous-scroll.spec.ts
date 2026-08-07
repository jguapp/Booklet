import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The PDF reader's continuous-scroll mode (pdf-reader.tsx's PdfScrollPageSlot)
 * -- an alternative to the default page-turn navigation, toggled in
 * Settings > Reading (device-prefs.ts's pdfReadingMode). Uses a 12-page
 * fixture (fixtures/multi-page.pdf, hand-built -- no PDF-construction
 * library is a dependency here) since sample.pdf (used elsewhere in this
 * suite) is only 2 pages, not enough to exercise lazy/virtualized
 * rendering of pages outside the viewport.
 */

const MULTI_PAGE_PDF = path.join(process.cwd(), "e2e", "fixtures", "multi-page.pdf");

async function selectFirstTextLayerSpanIn(page: import("@playwright/test").Page, containerSelector: string) {
  // pdf.js renders a page's canvas and its selectable text layer separately,
  // so the text layer can lag whatever this spec waited on to decide the page
  // was ready. Without waiting for a real span the evaluate below throws
  // "no text layer span to select" on whichever run loses that race. Waiting
  // rather than retrying: a reader cannot select text that hasn't rendered
  // either, so there is nothing here for the product to do differently.
  // (Same fix as highlight-citations.spec.ts -- this helper is duplicated
  // across the PDF specs; see #167 for folding them into one.)
  await page.locator(`${containerSelector} [class*="textLayer"] span`).first().waitFor({ state: "attached", timeout: 15_000 });
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    const span = container?.querySelector('[class*="textLayer"] span');
    if (!span?.firstChild) throw new Error("no text layer span to select");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.firstChild.textContent!.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    container!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.toString();
  }, containerSelector);
}

async function enableScrollMode(page: import("@playwright/test").Page) {
  await page.goto("/settings/reading");
  await page
    .getByRole("group", { name: "PDF reading mode" })
    .getByRole("button", { name: "Continuous scroll", exact: true })
    .click();
}

async function uploadMultiPagePdf(page: import("@playwright/test").Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(MULTI_PAGE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("defaults to page-turn mode -- only the current page is in the DOM", async ({ page }) => {
  await uploadMultiPagePdf(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 1 of 12/, { timeout: 10_000 });
  await expect(page.locator("[data-pdf-reader]")).toHaveCount(1);
  await expect(page.locator("[data-pdf-scroll-page]")).toHaveCount(0);
});

test("scroll mode renders every page slot but only rasterizes pages near the viewport", async ({ page }) => {
  await enableScrollMode(page);
  await uploadMultiPagePdf(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  // Every page gets a slot in the DOM immediately (so scroll height/
  // position is correct from the start)... canvas elements are always
  // mounted too (see PdfScrollPageSlot's comment on why), so "actually
  // rendered" is tracked via data-pdf-rendered, not element presence.
  await expect(page.locator("[data-pdf-scroll-page]")).toHaveCount(12, { timeout: 10_000 });
  // ...but nowhere near all 12 have actually rendered yet -- not rendered
  // eagerly, only lazily as they near the viewport.
  await page.waitForTimeout(500);
  const renderedNearTop = await page.locator('[data-pdf-rendered="true"]').count();
  expect(renderedNearTop).toBeGreaterThan(0);
  expect(renderedNearTop).toBeLessThan(12);
});

test("scrolling through the document renders more pages and advances the page indicator", async ({ page }) => {
  await enableScrollMode(page);
  await uploadMultiPagePdf(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator("[data-pdf-scroll-page]")).toHaveCount(12, { timeout: 10_000 });

  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 1 of 12/);

  await page.locator('[data-pdf-scroll-page="12"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 12 of 12/, { timeout: 5_000 });
  const renderedAfterScroll = await page.locator('[data-pdf-rendered="true"]').count();
  expect(renderedAfterScroll).toBeGreaterThan(1);
});

test("highlighting works in scroll mode, positioned over the right page", async ({ page }) => {
  await enableScrollMode(page);
  await uploadMultiPagePdf(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator("[data-pdf-scroll-page]")).toHaveCount(12, { timeout: 10_000 });
  // The text layer renders asynchronously after the canvas (see
  // PdfScrollPageSlot) -- wait for an actual span, not just the canvas.
  await expect(page.locator('[data-pdf-scroll-page="1"] [class*="textLayer"] span').first()).toBeAttached({
    timeout: 10_000,
  });

  const selectedText = await selectFirstTextLayerSpanIn(page, '[data-pdf-scroll-page="1"]');
  expect(selectedText.length).toBeGreaterThan(0);

  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await yellowSwatch.click();

  // The highlight overlay renders inside page 1's own slot, not some other page's.
  await expect(page.locator('[data-pdf-scroll-page="1"] [style*="background-color"]')).toBeVisible();
});
