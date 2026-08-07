import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * highlightCitation() (lib/highlights/citation.ts) -- surfaces the page
 * number a PDF highlight already carries (PdfPosition.pageNumber, captured
 * since the reader was built but never shown anywhere), and a lightweight
 * "Section N" for EPUB highlights derived from the CFI's own spine
 * position (no need to open the actual book file just to label a
 * highlight -- see the comment in citation.ts for why a real chapter
 * *title* isn't attempted here).
 */

const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");
const LONG_CHAPTER_EPUB = path.join(process.cwd(), "e2e", "fixtures", "long-chapter.epub");

async function selectFirstTextLayerSpan(page: import("@playwright/test").Page) {
  // pdf.js renders a page's canvas and its selectable text layer separately,
  // and the page indicator this spec waits on updates before the text layer
  // for the new page exists. Without waiting for a real span the evaluate
  // below throws "no text layer span to select" on whichever run loses that
  // race -- observed failing twice in a row in CI on a spec that had been
  // passing. Waiting is the fix rather than a retry: a reader cannot select
  // text that hasn't rendered either, so there is nothing here for the
  // product to do differently.
  await page.locator('[class*="textLayer"] span').first().waitFor({ state: "attached", timeout: 15_000 });
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
  });
}

test("a PDF highlight's citation shows the real page number", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(SAMPLE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.getByText(/Page 1 of 2/)).toBeVisible({ timeout: 10_000 });

  // Highlight on page 2, not page 1 -- the citation should say 2.
  await page.getByText("Next →", { exact: true }).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
  await selectFirstTextLayerSpan(page);
  await page.getByTitle("Yellow").click();

  await page.goto("/highlights");
  await expect(page.getByText("p. 2", { exact: true })).toBeVisible();
});

test("an EPUB highlight's citation shows a section reference", async ({ page }) => {
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
  await iframe.locator("p").first().evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const text = textNode.textContent ?? "";
    const range = el.ownerDocument.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(20, text.length));
    const selection = el.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByTitle("Yellow").click();

  await page.goto("/highlights");
  await expect(page.getByText(/^Section \d+$/)).toBeVisible();
});

test("an HTML highlight's citation shows which paragraph it's in, not just paragraph 1", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/long-article.html"); // ~40 paragraphs
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  // The 3rd paragraph specifically -- proves this counts real boundaries
  // instead of always landing on "Paragraph 1".
  const paragraph = page.locator("[data-article-content] p").nth(2);
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(20, textNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByTitle("Yellow").click();

  await page.goto("/highlights");
  const citation = page.getByText(/^Paragraph \d+$/);
  await expect(citation).toBeVisible();
  const text = await citation.textContent();
  const paragraphNumber = Number(text!.replace("Paragraph ", ""));
  expect(paragraphNumber).toBeGreaterThan(1);
});
