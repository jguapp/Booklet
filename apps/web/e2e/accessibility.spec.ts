import { expect, test } from "@playwright/test";

/**
 * Keyboard/focus-management regression coverage for SaveArticleModal -- the
 * most complex modal dialog in the app (multi-step, with a keyboard-only
 * dropzone; ConfirmDialog is a full-page-backdrop dialog too, but a much
 * simpler two-button one). Guards against: Tab escaping the dialog into the
 * Library page hidden behind the backdrop, focus not returning to the
 * triggering button on close, and the "Upload a file" dropzone being a
 * mouse-only <div onClick> with no way for a keyboard user to reach the
 * hidden <input type="file"> inside it.
 */

test("Tab stays trapped inside the save-article dialog, the upload dropzone is keyboard-reachable, and focus returns to the trigger on close", async ({
  page,
}) => {
  await page.goto("/library");

  const saveButton = page.getByRole("button", { name: "Save article" });
  await saveButton.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /save an article/i });
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Upload a file" }).click();
  const dropzone = page.getByRole("button", { name: /choose a \.pdf or \.epub file/i });
  await dropzone.focus();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await fileChooserPromise; // only resolves if the keydown handler actually opened the native picker

  // Forward-Tab from the last focusable element wraps back to the first.
  await page.getByRole("button", { name: "Save", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Paste a URL" })).toBeFocused();

  // Shift+Tab from the first wraps back to the last.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(saveButton).toBeFocused();
});
