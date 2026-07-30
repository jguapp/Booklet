import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The optional "prevent knowledge hoarding" backlog limit (Settings) --
 * off by default; when on and the unread count is at/over the limit,
 * clicking "Save article" asks first instead of opening the save modal
 * straight away.
 */

test("saving is unaffected while the toggle is off, even over a would-be limit", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await expect(page.getByRole("heading", { name: /save an article/i })).toBeVisible();
});

test("enabling the toggle with a low limit asks before saving once at/over it", async ({ page }) => {
  await page.goto("/settings/library");
  await page
    .getByRole("group", { name: "Prevent knowledge hoarding" })
    .getByRole("button", { name: "On", exact: true })
    .click();
  await page.getByLabel("Unread limit").fill("1");
  await page.getByLabel("Unread limit").blur();

  // First save: 0 unread so far, under the limit of 1 -- goes straight through.
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  // Second save: now 1 unread, at the limit -- should ask first.
  await page.getByRole("button", { name: /save article/i }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/unread pile is growing/i);
  await expect(page.getByRole("heading", { name: /save an article/i })).toHaveCount(0);

  // "Not now" cancels -- the save modal never opens.
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: /save an article/i })).toHaveCount(0);

  // "Save anyway" opens it.
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByRole("heading", { name: /save an article/i })).toBeVisible();
});
