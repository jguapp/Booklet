import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Settings' import (Pocket/Instapaper CSV -> real save-by-URL, same
 * pipeline as saving one by hand) and export (Markdown .zip, one file per
 * article -- see lib/data/export-import.ts for why Markdown rather than a
 * live Notion API sync).
 */

const POCKET_CSV = path.join(process.cwd(), "e2e", "fixtures", "pocket-export.csv");

test("importing a Pocket CSV export saves each URL for real", async ({ page }) => {
  await page.goto("/settings");
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import from Pocket" }).click(),
  ]);
  await fileChooser.setFiles(POCKET_CSV);

  await expect(page.getByText(/Imported 1, skipped 0/i)).toBeVisible({ timeout: 15_000 });

  // The library defaults to the "Reading" tab; an imported article is
  // UNREAD, so switch to "All" to see it.
  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();
});

test("exporting produces a zip with one Markdown file per article, including its highlights", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export as Markdown" }).click(),
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
