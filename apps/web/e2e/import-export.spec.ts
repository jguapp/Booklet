import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The dedicated Import & Export page's import (Pocket/Instapaper CSV ->
 * real save-by-URL, same pipeline as saving one by hand) and export
 * (Markdown .zip, one file per article -- see lib/data/export-import.ts
 * for why Markdown rather than a live Notion API sync).
 */

const POCKET_CSV = path.join(process.cwd(), "e2e", "fixtures", "pocket-export.csv");

test("importing a Pocket CSV export saves each URL for real", async ({ page }) => {
  await page.goto("/settings/import-export");
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Choose CSV" }).first().click(),
  ]);
  await fileChooser.setFiles(POCKET_CSV);

  await expect(page.getByText(/Imported 1, skipped 0/i)).toBeVisible({ timeout: 15_000 });

  // An imported article is UNREAD, which is the library's default tab.
  await page.goto("/library");
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();
});

test("exporting produces a zip with one Markdown file per article, including its highlights", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.goto("/settings/import-export");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export .zip" }).first().click(),
  ]);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const buffer = await readFile(filePath!);
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.keys(zip.files);
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(/\.md$/);

  const content = await zip.files[files[0]].async("string");
  expect(content).toContain("Readability");
  expect(content).toContain("en.wikipedia.org/wiki/Readability");
});

test("exporting to Anki produces a tab-separated file Anki's importer can read", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const range = document.createRange();
    const length = Math.min(20, textNode.textContent?.length ?? 0);
    range.setStart(textNode, 0);
    range.setEnd(textNode, length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByTitle("Yellow").click();

  await page.goto("/settings/import-export");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export .txt" }).click(),
  ]);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const content = await readFile(filePath!, "utf-8");
  const lines = content.split("\n");
  expect(lines[0]).toBe("#separator:tab");
  expect(lines[1]).toBe("#html:true");
  const cardLines = lines.slice(2).filter(Boolean);
  expect(cardLines.length).toBeGreaterThan(0);
  expect(cardLines[0].split("\t").length).toBe(2);
  expect(cardLines[0]).toContain("Readability");
});
