import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The in-reader right-side Notebook panel (notebook-panel.tsx) -- toggled
 * from the toolbar, shows an Info tab (article metadata) and a Notebook
 * tab (every highlight for the current article, in reading order),
 * clicking a highlight jumps the reader to it. No document-level note
 * field (a real Article schema change, split out of this issue) and no
 * AI/Chat tab (explicitly out of scope).
 */

async function selectFirstWords(page: import("@playwright/test").Page, count: number) {
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el, count) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const text = textNode.textContent ?? "";
    const end = text.split(/\s+/).slice(0, count).join(" ").length;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(end, text.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, count);
}

test("toggling the Notebook panel from the toolbar shows and hides it without losing reading position", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await expect(page.locator("[data-notebook-panel]")).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 600));
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.getByTitle("Show Notebook").click();
  await expect(page.locator("[data-notebook-panel]")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await page.getByTitle("Hide Notebook").click();
  await expect(page.locator("[data-notebook-panel]")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("Info tab shows article metadata", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Show Notebook").click();
  await page.getByRole("tab", { name: "Info" }).click();

  const panel = page.locator("[data-notebook-panel]");
  await expect(panel.getByText("Readability", { exact: true })).toBeVisible();
  await expect(panel.getByText("Saved")).toBeVisible();
});

test("HTML: a highlight appears in the Notebook tab, and clicking it jumps back to its location", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/long-article.html");  // long enough to scroll well past the highlight
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, 4);
  await page.getByTitle("Yellow").click();
  await expect(page.locator("mark[data-highlight-id]")).toBeVisible();

  await page.getByTitle("Show Notebook").click();
  await expect(page.getByRole("tab", { name: /Notebook \(1\)/ })).toBeVisible();

  // Scroll away from the highlight (it's near the top of the article).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(500);

  await page.locator("[data-notebook-panel] .cursor-pointer").first().click();

  // Jumped back near the top, where the highlighted mark lives.
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeLessThan(500);
});

test("PDF: a highlight appears in the Notebook tab, and clicking it jumps to the right page", async ({ page }) => {
  const MULTI_PAGE_PDF = path.join(process.cwd(), "e2e", "fixtures", "multi-page.pdf");
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(MULTI_PAGE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.waitForSelector('[data-pdf-reader] [class*="textLayer"] span', { timeout: 10_000 });
  await page.evaluate(() => {
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
  await page.getByTitle("Yellow").click();

  // Navigate away from page 1.
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 5 of/);

  await page.getByTitle("Show Notebook").click();
  await page.locator("[data-notebook-panel] .cursor-pointer").first().click();

  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 1 of/);
});

test("PDF continuous-scroll mode: clicking a highlight in the Notebook scrolls to the right page", async ({
  page,
}) => {
  const MULTI_PAGE_PDF = path.join(process.cwd(), "e2e", "fixtures", "multi-page.pdf");
  await page.goto("/settings/reading");
  await page
    .getByRole("group", { name: "PDF reading mode" })
    .getByRole("button", { name: "Continuous scroll", exact: true })
    .click();

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(MULTI_PAGE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await expect(page.locator("[data-pdf-scroll-page]")).toHaveCount(12, { timeout: 10_000 });
  await expect(page.locator('[data-pdf-scroll-page="1"] [class*="textLayer"] span').first()).toBeAttached({
    timeout: 10_000,
  });
  await page.evaluate(() => {
    const layer = document.querySelector('[data-pdf-scroll-page="1"] [class*="textLayer"]');
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
  await page.getByTitle("Yellow").click();

  await page.locator('[data-pdf-scroll-page="10"]').scrollIntoViewIfNeeded();
  await expect(page.locator("[data-pdf-page-indicator]")).not.toHaveText(/Page 1 of/);

  await page.getByTitle("Show Notebook").click();
  await page.locator("[data-notebook-panel] .cursor-pointer").first().click();

  // The exact page-tracking bug this guards against: a page scrolled to
  // just barely past the viewport's top (a sub-pixel rounding artifact,
  // not a real scroll-position error) must still count as "page 1 is
  // current," not lose out to page 2 just because page 2's top happens to
  // sit at a non-negative offset.
  await expect(page.locator("[data-pdf-page-indicator]")).toHaveText(/Page 1 of/, { timeout: 5_000 });
});

test("EPUB: a highlight appears in the Notebook tab, and clicking it navigates without error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page
    .locator("input[type='file']")
    .setInputFiles(path.join(process.cwd(), "e2e", "fixtures", "two-chapter.epub"));
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator("p").first()).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    const el = doc.querySelector("p")!;
    const textNode = el.firstChild!;
    const range = doc.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(20, textNode.textContent!.length));
    const sel = iframe.contentWindow!.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByTitle("Yellow").click();

  await page.getByTitle("Show Notebook").click();
  const row = page.locator("[data-notebook-panel] .cursor-pointer").first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
