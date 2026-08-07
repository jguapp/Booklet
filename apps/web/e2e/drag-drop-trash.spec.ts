import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Drag-and-drop onto the Trash nav link (app layout.tsx) -- article cards
 * drop straight to trash (reversible, same as their own trash button);
 * highlight cards go through a real confirm first (permanent delete is
 * their only "delete", no trash tier for highlights -- see trash-drop.ts).
 *
 * Native HTML5 DnD needs a real DataTransfer shared across the dispatched
 * events, which only exists inside the page -- simulated via a single
 * page.evaluate() rather than Playwright mouse actions (which don't
 * reliably trigger HTML5 drag events for custom, non-OS-level drags).
 */

async function simulateDrag(page: import("@playwright/test").Page, sourceSelector: string, targetSelector: string) {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !target) throw new Error("drag source or target not found");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    },
    { sourceSelector, targetSelector },
  );
}

test("dragging an article card onto Trash moves it there", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const card = page.locator("a[href^='/reader/']").first();
  await expect(card).toBeVisible();

  await simulateDrag(page, "a[href^='/reader/']", "a[href='/trash']");

  await expect(page.locator("a[href^='/reader/']")).toHaveCount(0);
  await page.goto("/trash");
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();
});

test("dragging a highlight onto Trash asks for confirmation before deleting it", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const range = document.createRange();
    const length = Math.min(12, textNode.textContent?.length ?? 0);
    range.setStart(textNode, 0);
    range.setEnd(textNode, length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await yellowSwatch.click();

  await page.goto("/highlights");
  // Scoped to <main> -- the sidebar's nav links are also draggable now (see
  // the nav-reorder feature), and sit earlier in the DOM, so an unscoped
  // "[draggable='true']" would grab the first nav link instead of the
  // highlight card.
  await expect(page.locator("main [draggable='true']").first()).toBeVisible();

  await simulateDrag(page, "main [draggable='true']", "a[href='/trash']");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/delete this highlight/i);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByText("No highlights yet for this filter.")).toBeVisible();
});
