import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Collection create/rename/delete from the sidebar -- local/anonymous mode
 * (IndexedDB), same as the rest of this e2e suite. No article needed since
 * a collection is just a named group; rename/delete buttons are hover-
 * revealed (opacity, not display:none, so they stay keyboard-focusable --
 * see AppLayoutInner), hence the explicit .hover() before clicking them.
 * Deleting goes through the app's own themed ConfirmDialog, not a native
 * browser confirm() -- see AppLayoutInner's pendingCollectionDelete.
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

  await renamedLink.hover();
  await renamedLink.locator('button[title="Delete collection"]').click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.locator("a", { hasText: renamed })).toHaveCount(0);
  await expect(page).toHaveURL(/\/library$/);
});

test("canceling the delete-collection dialog keeps the collection", async ({ page }) => {
  await page.goto("/library");

  const name = `E2E Collection ${Date.now()}`;
  await page.locator('button[title="New collection"]').click();
  const createInput = page.getByPlaceholder("Collection name");
  await createInput.fill(name);
  await createInput.press("Enter");

  const link = page.locator("a", { hasText: name });
  await expect(link).toBeVisible();

  await link.hover();
  await link.locator('button[title="Delete collection"]').click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(link).toBeVisible();
});

/**
 * "Add to collection" from a library card -- opening this menu before ever
 * creating a collection used to be a dead end ("No collections yet." with
 * no way to act on it), which is what made the feature look broken. It now
 * offers creating one right there, which both closes that dead end and is
 * the more common real path into a collection than the sidebar "+".
 */
test("adding an article to a brand new collection from the card menu, with no collections yet", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const card = page.locator("a[href^='/reader/']").first();
  await card.hover();
  await card.getByTitle("Add to collection").click();

  const menu = page.locator("div.absolute.right-0.top-7");
  await expect(menu.getByText("No collections yet.")).toBeVisible();
  await menu.getByText("New collection", { exact: true }).click();

  const nameInput = page.getByPlaceholder("Collection name");
  await nameInput.fill("Weekend Reads");
  await page.getByRole("button", { name: "Create & add" }).click();

  // The menu closes back to its normal state -- the new collection is
  // both created and the article's already a member of it.
  await expect(nameInput).toHaveCount(0);

  // The card itself is tagged with its new collection immediately, with no
  // reload -- this is the onMembershipChange path, not a refetch.
  await expect(card.getByTitle("In collection: Weekend Reads")).toBeVisible();

  // Shows up in the sidebar immediately, no reload needed.
  const sidebarLink = page.locator("nav a", { hasText: "Weekend Reads" });
  await expect(sidebarLink).toBeVisible();

  await sidebarLink.click();
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);

  // Survives a real reload too -- not just optimistic local state.
  await page.reload();
  await expect(page.locator("a[href^='/reader/']").first().getByTitle("In collection: Weekend Reads")).toBeVisible();
});

test("removing an article from a collection removes its badge from the card", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const card = page.locator("a[href^='/reader/']").first();
  await card.hover();
  await card.getByTitle("Add to collection").click();
  const menu = page.locator("div.absolute.right-0.top-7");
  await menu.getByText("New collection", { exact: true }).click();
  await page.getByPlaceholder("Collection name").fill("Temp Collection");
  await page.getByRole("button", { name: "Create & add" }).click();
  await expect(card.getByTitle("In collection: Temp Collection")).toBeVisible();

  // The menu stays open after creating -- toggle the same collection back
  // off directly, no need to reopen it.
  await menu.getByText("Temp Collection", { exact: true }).click();
  await expect(card.getByTitle("In collection: Temp Collection")).toHaveCount(0);
});

/** Authenticated mode fetches membership from the real bulk API route
 * (GET /api/articles/collection-memberships) instead of IndexedDB -- the
 * rest of this file runs anonymous/local, so this is the only coverage of
 * that actual network round trip. */
test("collection badges work in authenticated mode too", async ({ page }) => {
  const email = `collection-badge-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Collection Badge Test");
  await page.getByLabel("Email").fill(email);
  // exact: true -- a substring match of "Password" also catches the
  // password field's own "Show password" visibility toggle button.
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const card = page.locator("a[href^='/reader/']").first();
  await card.hover();
  await card.getByTitle("Add to collection").click();
  const menu = page.locator("div.absolute.right-0.top-7");
  await menu.getByText("New collection", { exact: true }).click();
  await page.getByPlaceholder("Collection name").fill("Work Reading");
  await page.getByRole("button", { name: "Create & add" }).click();
  await expect(card.getByTitle("In collection: Work Reading")).toBeVisible();

  await page.reload();
  await expect(page.locator("a[href^='/reader/']").first().getByTitle("In collection: Work Reading")).toBeVisible();
});
