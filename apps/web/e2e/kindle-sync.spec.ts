import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Kindle sync is two independent, one-directional flows (see the issue this
 * shipped from for why real two-way sync isn't attempted): importing a
 * Kindle "My Clippings.txt" export (works in local/anonymous mode, same as
 * every other import path), and "Send to Kindle" from the reader (needs a
 * real account, since it requires emailing a file from a real server).
 */

test("importing a Kindle clippings export creates one article per book with its highlights", async ({ page }) => {
  const clippings = [
    "Sample Book (Jane Author)",
    "- Your Highlight on page 12 | Location 200-210 | Added on Monday, January 1, 2024",
    "",
    "This is the first highlighted passage.",
    "==========",
    "Sample Book (Jane Author)",
    "- Your Highlight on page 30 | Location 400-410 | Added on Tuesday, January 2, 2024",
    "",
    "This is the second highlighted passage.",
    "==========",
  ].join("\n");

  await page.goto("/settings/import-export");
  await page
    .locator('input[type="file"][accept=".txt,text/plain"]')
    .setInputFiles({ name: "My Clippings.txt", mimeType: "text/plain", buffer: Buffer.from(clippings, "utf-8") });

  await expect(page.getByText("Imported 2 highlights from 1 book.")).toBeVisible();

  await page.goto("/library");
  // A fresh import lands as UNREAD, but the Library's default tab is
  // "Reading" (see handleSaved's comment in library/page.tsx) -- switch
  // tabs to actually see it, same as any other freshly-saved article would
  // need if it hadn't gone through the save-article modal's own tab-switch.
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("Sample Book")).toBeVisible();

  await page.getByText("Sample Book").click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.getByText("This is the first highlighted passage.")).toBeVisible();
  await expect(page.getByText("This is the second highlighted passage.")).toBeVisible();
});

test("re-importing the same file doesn't duplicate the book article, only its highlights", async ({ page }) => {
  const clippings = [
    "Repeat Book (Some Author)",
    "- Your Highlight on page 1 | Location 1-2 | Added on Monday, January 1, 2024",
    "",
    "Only entry.",
    "==========",
  ].join("\n");

  await page.goto("/settings/import-export");
  const fileInput = page.locator('input[type="file"][accept=".txt,text/plain"]');
  await fileInput.setInputFiles({ name: "My Clippings.txt", mimeType: "text/plain", buffer: Buffer.from(clippings, "utf-8") });
  await expect(page.getByText("Imported 1 highlight from 1 book.")).toBeVisible();

  await fileInput.setInputFiles({ name: "My Clippings.txt", mimeType: "text/plain", buffer: Buffer.from(clippings, "utf-8") });
  await expect(page.getByText("Imported 1 highlight from 1 book.")).toBeVisible();

  await page.goto("/library");
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("Repeat Book")).toHaveCount(1);
});

test("setting a Kindle email lets you send an article from the reader", async ({ page }) => {
  const email = `kindle-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Kindle Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  await page.goto("/settings");
  await page.getByLabel("Kindle email").fill("reader_abc123@kindle.com");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/E-reader");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByRole("button", { name: "Send to Kindle" }).click();
  await expect(page.getByRole("status").getByText(/sent to your kindle/i)).toBeVisible({ timeout: 10_000 });
});
