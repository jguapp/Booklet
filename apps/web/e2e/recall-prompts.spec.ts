import { expect, test } from "@playwright/test";
import { FIXTURES, waitForSaveModalToClose } from "./helpers";

/**
 * Recall prompts (#157) end to end: write a question on a highlight from the
 * Highlights page, then confirm Daily Review asks it *before* showing the
 * passage, and withholds the grade buttons until the passage has been asked
 * for.
 *
 * The unit tests in highlight-list-item.test.tsx pin the component's
 * concealment rule; this pins the round trip -- that a prompt written on one
 * page survives the data layer and changes what the review page does. Runs
 * anonymous/local, so it also covers local-mode parity, which the issue
 * called out explicitly.
 */

const PROMPT = "What does the sample article open by claiming?";

/** Saves a fixture article and highlights the opening of its first
 * paragraph, returning the exact text that got highlighted -- the assertions
 * below turn on that text being *absent* from the page, so it has to be the
 * real string rather than a guess. */
async function saveAndHighlight(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(FIXTURES.article);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  const paragraph = page.locator("[data-article-content] p").first();
  await expect(paragraph).toBeVisible({ timeout: 10_000 });
  const selectedText = await paragraph.evaluate((el) => {
    const textNode = el.firstChild;
    if (!textNode) throw new Error("paragraph has no text node");
    const range = document.createRange();
    const length = Math.min(30, textNode.textContent?.length ?? 0);
    range.setStart(textNode, 0);
    range.setEnd(textNode, length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.toString();
  });
  await page.getByTitle("Yellow").click();
  return selectedText;
}

async function addPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.goto("/highlights");
  await page.getByRole("button", { name: "+ Add a recall prompt" }).click();
  await page.getByPlaceholder(/Ask a question/i).fill(prompt);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(prompt)).toBeVisible();
}

test("a prompted highlight asks its question before showing the passage", async ({ page }) => {
  const selectedText = await saveAndHighlight(page);
  await addPrompt(page, PROMPT);

  await page.goto("/resurface");
  await expect(page.getByText(PROMPT)).toBeVisible();

  // The point of the whole feature: the answer is not on screen, and neither
  // is a way to grade yourself on it.
  await expect(page.getByText(selectedText)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remembered this" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forgot this" })).toHaveCount(0);
  // Archive stays available throughout -- being done with a highlight isn't
  // a recall judgment and needs no answer.
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show the highlight" }).click();
  await expect(page.getByText(selectedText)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remembered this" })).toBeVisible();

  // And grading still works once revealed, landing the highlight in the
  // library exactly as an unprompted one would.
  await page.getByRole("button", { name: "Remembered this" }).click();
  await expect(page.getByRole("status")).toContainText(/you'll see this again in \d+ days?/i);
});

test("a highlight with no prompt is unaffected", async ({ page }) => {
  const selectedText = await saveAndHighlight(page);

  await page.goto("/resurface");
  // Straight to the passage and the grade buttons, no reveal step -- this is
  // what makes prompts additive rather than a change to everyone's review.
  await expect(page.getByText(selectedText)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show the highlight" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remembered this" })).toBeVisible();
});

test("a prompt can be removed, putting the highlight back on the plain path", async ({ page }) => {
  const selectedText = await saveAndHighlight(page);
  await addPrompt(page, PROMPT);

  await page.goto("/highlights");
  await page.getByTitle("Remove prompt").click();
  await expect(page.getByText(PROMPT)).toHaveCount(0);

  await page.goto("/resurface");
  await expect(page.getByText(selectedText)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show the highlight" })).toHaveCount(0);
});

/** Authenticated mode goes through the real PATCH /api/highlights/:id and
 * comes back through GET /api/digests/current, so this is the only coverage
 * of the prompt actually persisting server-side and arriving on the digest's
 * own batch rather than the client's local copy. */
test("prompts work in authenticated mode too", async ({ page }) => {
  const email = `recall-prompt-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Recall Prompt Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  const selectedText = await saveAndHighlight(page);
  await addPrompt(page, PROMPT);

  // A full reload, so nothing below can be served by in-memory state that
  // never reached the server.
  await page.goto("/resurface");
  await expect(page.getByText(PROMPT)).toBeVisible();
  await expect(page.getByText(selectedText)).toHaveCount(0);

  await page.getByRole("button", { name: "Show the highlight" }).click();
  await expect(page.getByText(selectedText)).toBeVisible();
});
