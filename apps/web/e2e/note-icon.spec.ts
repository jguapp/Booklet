import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * A highlight's note used to render inline in the article body as a pill
 * with a truncated preview of the note's own text -- disruptive to actually
 * reading. Now it's an icon-only marker (article-content.tsx's note-pill);
 * clicking it shows the note directly in HighlightManagePopover, Apple
 * Books style, rather than requiring an extra click into "Edit note" first.
 */

async function saveUrl(page: import("@playwright/test").Page, url: string) {
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

async function selectFirstWords(page: import("@playwright/test").Page, count: number) {
  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  await paragraph.evaluate((el, count) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const text = textNode.textContent ?? "";
    const end = text.split(/\s+/).slice(0, count).join(" ").length;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(end, text.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, count);
}

test("a highlight's note shows as an icon, not inline text, and opens on click", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "http://127.0.0.1:4321/readability.html");

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, 4);
  const yellowSwatch = page.getByTitle("Yellow");
  await expect(yellowSwatch).toBeVisible({ timeout: 5_000 });
  await page.getByTitle("Add a note").click();
  const noteText = "This is my private note about this passage.";
  await page.getByPlaceholder("Add a note…").fill(noteText);
  await page.getByRole("button", { name: "Save highlight" }).click();

  const articleContent = page.locator("[data-article-content]");
  await expect(articleContent.locator(".note-pill")).toBeVisible();
  // The note's own text must never sit in the reading flow.
  await expect(articleContent).not.toContainText(noteText);

  await articleContent.locator(".note-pill").click();
  // Reading the note takes exactly one click -- no separate "Edit" step.
  await expect(page.getByText(noteText, { exact: true })).toBeVisible();
});

test("editing and deleting a note still works from the read view", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "http://127.0.0.1:4321/readability.html");
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await selectFirstWords(page, 4);
  await expect(page.getByTitle("Yellow")).toBeVisible({ timeout: 5_000 });
  await page.getByTitle("Add a note").click();
  await page.getByPlaceholder("Add a note…").fill("original note");
  await page.getByRole("button", { name: "Save highlight" }).click();

  const articleContent = page.locator("[data-article-content]");
  await articleContent.locator(".note-pill").click();
  await expect(page.getByText("original note", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByPlaceholder("Add a note…").fill("updated note");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await articleContent.locator(".note-pill").click();
  await expect(page.getByText("updated note", { exact: true })).toBeVisible();

  await page.getByTitle("Delete note").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(articleContent.locator(".note-pill")).toHaveCount(0);
});
