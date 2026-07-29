import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Exercises the real PDF reader (pdf-reader.tsx) end to end -- canvas +
 * text-layer rendering, selecting text to create a highlight, the
 * PDF-space-rect <-> viewport-pixel coordinate conversion that positions
 * the highlight overlay, page-scoping across a multi-page document, and
 * deleting a highlight. None of this is reachable through unit tests: it's
 * real pdfjs-dist canvas rendering and DOM Range/selection behavior in an
 * actual browser.
 */

const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");

async function selectFirstTextLayerSpan(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[class*="textLayer"]');
    const span = layer?.querySelector("span");
    if (!span?.firstChild) throw new Error("no text layer span to select");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.firstChild.textContent!.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    layer!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.toString();
  });
}

test("upload a PDF, highlight real rendered text, and see it persist and delete", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept()); // the manage popover's delete confirm is a real window.confirm()

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(SAMPLE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByRole("button", { name: /save article/i })).toBeVisible({ timeout: 20_000 });

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  // The extracted-text fallback message should be gone -- this is the real reader.
  await expect(page.locator("text=shown as extracted text")).toHaveCount(0);
  await expect(page.getByText(/Page 1 of 2/)).toBeVisible({ timeout: 10_000 });
  const canvas = page.locator("[data-pdf-reader] canvas");
  await expect(canvas).toBeVisible();
  await expect(async () => {
    const box = await canvas.boundingBox();
    expect(box && box.width).toBeGreaterThan(100);
  }).toPass({ timeout: 10_000 });

  const selectedText = await selectFirstTextLayerSpan(page);
  expect(selectedText.length).toBeGreaterThan(0);

  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await yellowSwatch.click();

  const overlay = page.locator('[class*="highlightOverlay"] > div');
  await expect(overlay).toHaveCount(1);

  // Page 2 shouldn't show page 1's highlight.
  await page.getByText("Next →", { exact: true }).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await page.getByText("← Prev", { exact: true }).click();
  await expect(page.getByText(/Page 1 of 2/)).toBeVisible();
  await expect(overlay).toHaveCount(1);

  // Persists across a reload (re-fetches the file, re-renders, re-resolves the highlight).
  await page.reload();
  await expect(page.getByText(/Page 1 of 2/)).toBeVisible({ timeout: 10_000 });
  await expect(overlay).toHaveCount(1);

  await overlay.first().click();
  await page.getByTitle("Delete highlight").click();
  await expect(overlay).toHaveCount(0);
});
