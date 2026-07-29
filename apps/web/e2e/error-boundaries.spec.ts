import { expect, test } from "@playwright/test";

/**
 * not-found.tsx and error.tsx -- the route-level boundaries that catch
 * everything global-error.tsx doesn't (that one only fires for an error
 * thrown by the root layout itself, not by a page). Only not-found.tsx is
 * covered here: exercising error.tsx for real needs a route that
 * deliberately throws, which isn't something worth shipping permanently
 * just to test against -- it was verified by hand instead (a temporary
 * throwing route, confirmed the 500 status, the branded fallback UI, and
 * that "Try again" actually retries the render), see the commit that added
 * these two files for how.
 */

test("an unmatched route shows the branded 404 page, not Next.js's default", async ({ page }) => {
  const response = await page.goto("/this-route-will-never-exist-xyz");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /that page doesn't exist/i })).toBeVisible();
  await page.getByRole("link", { name: /back to library/i }).click();
  await expect(page).toHaveURL(/\/library$/);
});
