import { expect, test } from "@playwright/test";

/**
 * With no GOOGLE_CLIENT_ID/GITHUB_CLIENT_ID configured (the real state of
 * this dev environment -- see apps/api/src/test/oauth.test.ts for the
 * configured-provider behavior, tested at the unit level instead since it
 * needs fake credentials), the login/signup pages should render normally
 * with no OAuth buttons, not break or show dead links.
 */

test("login page renders normally with no OAuth buttons when no provider is configured", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /continue with google/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /continue with github/i })).toHaveCount(0);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("signup page renders normally with no OAuth buttons when no provider is configured", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await expect(page.getByRole("link", { name: /continue with google/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /continue with github/i })).toHaveCount(0);
});

test("login page shows an error banner after a failed OAuth attempt", async ({ page }) => {
  await page.goto("/login?error=oauth_failed");
  await expect(page.getByText(/that sign-in attempt didn't go through/i)).toBeVisible();
});
