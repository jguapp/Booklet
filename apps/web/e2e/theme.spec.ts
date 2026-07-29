import { expect, test } from "@playwright/test";

/**
 * Theme switching -- the ThemeSwitcher in the app shell (available from any
 * page, not just Settings) and the Kindle e-ink theme specifically (pure
 * black-on-white, no hue, styled after e-ink readers).
 */

test("switching to the Kindle theme from the sidebar applies black-on-white and persists across a reload", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("group", { name: "Theme" }).getByTitle("Kindle").click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "kindle");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(0, 0, 0)");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "kindle");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
