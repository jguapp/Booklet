import { expect, test } from "@playwright/test";

/**
 * Nested collections via drag-and-drop re-parenting (see
 * lib/data/collections.ts). Smart (saved-search) collections -- membership
 * computed live from a filter (packages/shared/collection-filter.ts) --
 * still exist in the schema/API, but the Library page's "save this search
 * as a collection" UI that was their only creation surface was removed, so
 * there's no longer a UI flow to cover here.
 */

async function createManualCollection(page: import("@playwright/test").Page, name: string) {
  await page.locator('button[title="New collection"]').click();
  const createInput = page.getByPlaceholder("Collection name");
  await createInput.fill(name);
  await createInput.press("Enter");
  await expect(page.locator("a", { hasText: name })).toBeVisible();
}

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
