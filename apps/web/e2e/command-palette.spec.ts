import { expect, test, type Page } from "@playwright/test";

/**
 * Cmd/Ctrl+K command palette -- fuzzy-matches nav items, collections, and
 * actions (theme, reading-stats toggle) that already have real handlers
 * elsewhere, plus falls through to a live article search. See
 * components/command-palette/command-palette.tsx.
 */

/** The keydown listener attaches in a useEffect, after React hydrates --
 * page.goto() itself only waits for the 'load' event, which can resolve
 * before that. Waiting for the sidebar's own "Search" button (which only
 * exists once the shell has actually rendered) before sending the
 * shortcut avoids racing hydration, rather than firing Control+K the
 * instant navigation resolves. */
async function openPalette(page: Page) {
  await page.getByRole("button", { name: "Search ⌘K" }).waitFor({ state: "visible" });
  await page.keyboard.press("Control+k");
  await page.getByLabel("Command palette search").waitFor({ state: "visible" });
}

test("Ctrl+K opens the palette, and Escape closes it", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);

  await openPalette(page);
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
});

test("typing navigates via fuzzy match, keyboard-only", async ({ page }) => {
  await page.goto("/library");
  await openPalette(page);
  await page.getByLabel("Command palette search").fill("trash");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/trash/);
});

test("a theme action runs immediately and closes the palette", async ({ page }) => {
  await page.goto("/library");
  await openPalette(page);
  await page.getByLabel("Command palette search").fill("Theme: Dark");
  await page.getByRole("option", { name: /Theme: Dark/ }).click();

  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a saved collection shows up and navigates to it", async ({ page }) => {
  await page.goto("/library");
  const name = `Palette Test ${Date.now()}`;
  await page.locator('button[title="New collection"]').click();
  const createInput = page.getByPlaceholder("Collection name");
  await createInput.fill(name);
  await createInput.press("Enter");
  await expect(page).toHaveURL(/\/library\?collection=/);

  await page.goto("/library");
  await openPalette(page);
  await page.getByLabel("Command palette search").fill(name);
  await expect(page.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/library\?collection=/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("free text falls through to a live article search", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.getByRole("heading", { name: /save an article/i }).waitFor({ state: "hidden", timeout: 20_000 });

  await openPalette(page);
  await page.getByLabel("Command palette search").fill("Readability");
  const result = page.getByRole("option", { name: /Readability/ });
  await expect(result).toBeVisible({ timeout: 5_000 });
  await result.click();
  await expect(page).toHaveURL(/\/reader\//);
});
