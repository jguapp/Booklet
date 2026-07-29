import { expect, test } from "@playwright/test";

/**
 * Collection create/rename/delete from the sidebar -- local/anonymous mode
 * (IndexedDB), same as the rest of this e2e suite. No article needed since
 * a collection is just a named group; rename/delete buttons are hover-
 * revealed (opacity, not display:none, so they stay keyboard-focusable --
 * see AppLayoutInner), hence the explicit .hover() before clicking them.
 */

test("create, rename, and delete a collection from the sidebar", async ({ page }) => {
  await page.goto("/library");

  const name = `E2E Collection ${Date.now()}`;
  await page.locator('button[title="New collection"]').click();
  const createInput = page.getByPlaceholder("Collection name");
  await createInput.fill(name);
  await createInput.press("Enter");

  const link = page.locator("a", { hasText: name });
  await expect(link).toBeVisible();
  await expect(page).toHaveURL(/\/library\?collection=/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await link.hover();
  await link.locator('button[title="Rename collection"]').click();
  const renamed = `${name} renamed`;
  const renameInput = page.locator("nav input");
  await renameInput.fill(renamed);
  await renameInput.press("Enter");

  const renamedLink = page.locator("a", { hasText: renamed });
  await expect(renamedLink).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await renamedLink.hover();
  await renamedLink.locator('button[title="Delete collection"]').click();

  await expect(page.locator("a", { hasText: renamed })).toHaveCount(0);
  await expect(page).toHaveURL(/\/library$/);
});
