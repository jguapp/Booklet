import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Smart (saved-search) collections -- membership computed live from a
 * filter instead of stored ArticleCollection rows (see
 * lib/data/collections.ts and packages/shared/collection-filter.ts) -- and
 * nested collections via drag-and-drop re-parenting.
 */

async function createManualCollection(page: import("@playwright/test").Page, name: string) {
  await page.locator('button[title="New collection"]').click();
  const createInput = page.getByPlaceholder("Collection name");
  await createInput.fill(name);
  await createInput.press("Enter");
  await expect(page.locator("a", { hasText: name })).toBeVisible();
}

test("saving a filtered search as a collection tracks matching articles live", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  // Freshly saved -> UNREAD tab. Tag it via the reader, then come back and
  // filter the library down to that tag so there's an active, savable filter.
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await page.locator("a[href^='/reader/']").first().click();
  await page.waitForURL(/\/reader\//);
  const tagInput = page.getByPlaceholder(/add a tag/i);
  await tagInput.waitFor({ state: "visible" });
  await tagInput.fill("smart-collection-tag");
  await tagInput.press("Enter");
  await expect(page.locator('button[title^="Remove"]')).toContainText("smart-collection-tag");

  await page.goto("/library");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.locator("button", { hasText: "smart-collection-tag" }).click();

  await expect(page.getByText("Save this search as a collection")).toBeVisible();
  await page.getByText("Save this search as a collection").click();
  const name = `Smart ${Date.now()}`;
  await page.getByPlaceholder("Collection name").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const sidebarLink = page.locator("nav a", { hasText: name });
  await expect(sidebarLink).toBeVisible();
  await sidebarLink.click();
  await expect(page).toHaveURL(/\/library\?collection=/);
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();

  // Newly saved, differently-tagged article shouldn't show up in the smart
  // collection -- proves it's a live filter, not a one-time snapshot.
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Tag_(metadata)");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await sidebarLink.click();
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tag (metadata)", { exact: true })).toHaveCount(0);
});

test("nesting one collection under another via drag-and-drop", async ({ page }) => {
  await page.goto("/library");
  await createManualCollection(page, "Parent Folder");
  await createManualCollection(page, "Child Folder");

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const child = page.locator("nav a", { hasText: "Child Folder" });
  const parent = page.locator("nav a", { hasText: "Parent Folder" });

  await child.dispatchEvent("dragstart", { dataTransfer });
  await parent.dispatchEvent("dragenter", { dataTransfer });
  await parent.dispatchEvent("dragover", { dataTransfer });
  await parent.dispatchEvent("drop", { dataTransfer });

  // Reload to confirm the nesting actually persisted (not just optimistic
  // client state) and that the child renders indented under its parent.
  await page.reload();
  const childAfter = page.locator("nav a", { hasText: "Child Folder" });
  const parentAfter = page.locator("nav a", { hasText: "Parent Folder" });
  await expect(childAfter).toBeVisible();
  const childPadding = await childAfter.evaluate((el) => getComputedStyle(el).paddingLeft);
  const parentPadding = await parentAfter.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(parseFloat(childPadding)).toBeGreaterThan(parseFloat(parentPadding));
});
