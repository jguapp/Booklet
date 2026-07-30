import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The highlight-bar customization setting (Settings > Reading) --
 * toggling which curated-palette colors show up in the highlight picker,
 * and adding a fully custom hex color, both a real device-local
 * preference (lib/reader/device-prefs.ts) that the actual highlight
 * picker (highlight-popover.tsx) reads from.
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

test("removing a color from the highlight bar removes it from the picker, and it persists across a reload", async ({
  page,
}) => {
  await page.goto("/settings/reading");
  await expect(page.getByText("Your highlight bar (5 of 12)")).toBeVisible();

  await page.getByRole("button", { name: "Green", exact: true }).click();
  await expect(page.getByText("Your highlight bar (4 of 12)")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Your highlight bar (4 of 12)")).toBeVisible();
  // The curated-palette swatch itself should no longer show the active checkmark.
  await expect(page.getByRole("button", { name: "Green", exact: true }).locator("svg")).toHaveCount(0);

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, 4);
  await expect(page.getByTitle("Yellow")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTitle("Green")).toHaveCount(0);
});

test("adding a custom hex color makes it available in the picker and it renders on the highlight", async ({
  page,
}) => {
  await page.goto("/settings/reading");
  await page.locator('input[type="text"][placeholder="#7EC8E3"]').fill("#123ABC");
  await page.getByRole("button", { name: "Add hex" }).click();
  await expect(page.getByText("Your highlight bar (6 of 12)")).toBeVisible();

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, 4);
  const swatch = page.getByTitle("#123ABC");
  await expect(swatch).toBeVisible({ timeout: 5_000 });
  await swatch.click();

  const mark = page.locator("mark[data-highlight-id]").first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveCSS("background-color", "rgb(18, 58, 188)");
});

test("an invalid hex is rejected with an inline error, not silently added", async ({ page }) => {
  await page.goto("/settings/reading");
  await page.locator('input[type="text"][placeholder="#7EC8E3"]').fill("not-a-color");
  await page.getByRole("button", { name: "Add hex" }).click();
  await expect(page.getByText("Enter a valid hex color, like #7EC8E3.")).toBeVisible();
  await expect(page.getByText("Your highlight bar (5 of 12)")).toBeVisible();
});

test("the highlight bar can never be emptied to zero colors", async ({ page }) => {
  await page.goto("/settings/reading");
  for (const label of ["Yellow", "Green", "Blue", "Pink"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await expect(page.getByText("Your highlight bar (1 of 12)")).toBeVisible();

  // The last remaining color's remove (x) affordance shouldn't be able to
  // take it down to zero -- clicking the last curated-palette swatch
  // itself is a no-op once it's the only one left.
  await page.getByRole("button", { name: "Orange", exact: true }).click();
  await expect(page.getByText("Your highlight bar (1 of 12)")).toBeVisible();
});
