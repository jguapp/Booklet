import type { Page } from "@playwright/test";

/**
 * Waits for the save-article modal to actually close. The naive
 * `getByRole("button", { name: /save article/i })).toBeVisible()` looks
 * right but isn't: that's the Library page's own button that opens the
 * modal, and it's always present (just visually covered by the modal's
 * backdrop) whether or not the save has finished -- so it never actually
 * gates on anything, and once let through, tests can go on to assert
 * against a still-in-flight save. Wait for the modal's heading to
 * disappear instead.
 */
export async function waitForSaveModalToClose(page: Page): Promise<void> {
  await page.getByRole("heading", { name: /save an article/i }).waitFor({ state: "hidden", timeout: 20_000 });
}
