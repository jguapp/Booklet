import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Exercises the real EPUB reader (epub-reader.tsx) end to end -- epub.js
 * rendering each chapter into its own iframe, selecting text inside that
 * iframe to create a CFI-anchored highlight, the resulting marks-pane SVG
 * overlay (a sibling of the iframe in the parent document, not inside it --
 * see epub-reader.tsx's pointer-events comment), chapter navigation, and
 * deleting a highlight. None of this is reachable through unit tests: it's
 * real cross-iframe selection and epub.js/marks-pane DOM behavior in an
 * actual browser.
 */

const TWO_CHAPTER_EPUB = path.join(process.cwd(), "e2e", "fixtures", "two-chapter.epub");

async function selectWordInFirstParagraph(page: Page, word: string) {
  return page.evaluate((needle) => {
    const iframe = document.querySelector<HTMLIFrameElement>("[data-epub-reader] iframe");
    const idoc = iframe?.contentDocument;
    const p = idoc?.querySelector("p");
    const textNode = p?.firstChild;
    if (!iframe || !idoc || !textNode?.textContent) throw new Error("no paragraph text node to select");
    const start = textNode.textContent.indexOf(needle);
    if (start === -1) throw new Error(`"${needle}" not found in paragraph`);
    const range = idoc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + needle.length);
    const selection = iframe.contentWindow?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    iframe.contentWindow?.document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, word);
}

test("upload an EPUB, highlight real rendered text across chapters, and see it persist and delete", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(TWO_CHAPTER_EPUB);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator("text=shown as extracted text")).toHaveCount(0);

  const iframe = page.frameLocator("[data-epub-reader] iframe");
  await expect(iframe.locator("h1")).toHaveText("Chapter One", { timeout: 10_000 });

  await page.getByText("Next →", { exact: true }).click();
  await expect(iframe.locator("h1")).toHaveText("Chapter Two", { timeout: 10_000 });
  await page.getByText("← Prev", { exact: true }).click();
  await expect(iframe.locator("h1")).toHaveText("Chapter One", { timeout: 10_000 });

  await selectWordInFirstParagraph(page, "first chapter");
  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await yellowSwatch.click();

  const mark = page.locator("[data-epub-reader] g[data-highlight-id]");
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute("fill", "#F3DE9C");

  // Persists across a reload (re-opens the book, re-renders the section, re-adds the annotation).
  await page.reload();
  await expect(iframe.locator("h1")).toHaveText("Chapter One", { timeout: 10_000 });
  await expect(mark).toHaveCount(1);

  await mark.first().click();
  await page.getByTitle("Delete highlight").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(mark).toHaveCount(0);
});
