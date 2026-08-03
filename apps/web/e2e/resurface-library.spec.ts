import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Daily Review's "Highlights library" section (resurface/page.tsx) -- lets
 * a user browse everything currently remembered/forgotten/archived and move
 * a highlight between those at any time, plus "Due in N days" transparency
 * on when it'll resurface again. Separate from today's review batch above
 * it, which anonymous-flow.spec.ts already covers.
 */

const TEST_ARTICLE_URL = "https://en.wikipedia.org/wiki/Readability";

async function saveAndHighlight(page: import("@playwright/test").Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(TEST_ARTICLE_URL);
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
  await page.getByTitle("Yellow").click();
}

test("marking a highlight Remembered moves it into the library's Remembered tab with a due date", async ({
  page,
}) => {
  await saveAndHighlight(page);

  await page.goto("/resurface");
  await page.getByRole("button", { name: "Remembered this" }).click();
  await expect(page.getByRole("status")).toContainText(/you'll see this again in \d+ days?/i);

  await page.getByRole("button", { name: "Highlights library" }).click();
  await expect(page.getByRole("button", { name: /^Remembered \(1\)$/ })).toBeVisible();
  // First-ever review of a highlight always lands on a 1-day SM-2 interval
  // regardless of REMEMBERED/FORGOT (repetitions starts at 0 either way) --
  // "Due tomorrow", not yet "Due in N days" (that only shows up after a
  // second successful review grows the interval further).
  await expect(page.getByText(/^Due (today|tomorrow|in \d+ days)$/)).toBeVisible();
});

test("moving a highlight between Remembered, Forgot, and Archived from the library", async ({ page }) => {
  await saveAndHighlight(page);

  await page.goto("/resurface");
  await page.getByRole("button", { name: "Remembered this" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByRole("button", { name: "Highlights library" }).click();
  await expect(page.getByRole("button", { name: /^Remembered \(1\)$/ })).toBeVisible();

  // Remembered -> Forgot.
  await page.getByRole("button", { name: "Forgot this" }).click();
  await expect(page.getByRole("button", { name: /^Forgot \(1\)$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remembered \(0\)$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Forgot \(1\)$/ }).click();
  // First-ever review of a highlight always lands on a 1-day SM-2 interval
  // regardless of REMEMBERED/FORGOT (repetitions starts at 0 either way) --
  // "Due tomorrow", not yet "Due in N days" (that only shows up after a
  // second successful review grows the interval further).
  await expect(page.getByText(/^Due (today|tomorrow|in \d+ days)$/)).toBeVisible();

  // Forgot -> Archived. exact: true -- "Archive" is otherwise a substring
  // match of the "Archived (N)" tab buttons too.
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Archived \(1\)$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Forgot \(0\)$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Archived \(1\)$/ }).click();
  await expect(page.getByText("Won't resurface again", { exact: true })).toBeVisible();

  // Archived -> restored, no longer counted anywhere until re-reviewed.
  // Toasts stack rather than replace -- .last() is the one this action
  // just triggered, not an earlier one still on screen.
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status").last()).toContainText(/restored/i);
  await expect(page.getByRole("button", { name: /^Archived \(0\)$/ })).toBeVisible();
});

/** Authenticated mode fetches the library's full highlight set from the
 * real bulk API route (GET /api/highlights) separately from the digest's
 * own persisted batch (GET /api/digests/current) -- the rest of this file
 * runs anonymous/local, so this is the only coverage of that real round
 * trip and of the two staying in sync. */
test("the library works in authenticated mode too", async ({ page }) => {
  const email = `resurface-library-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Resurface Library Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  await saveAndHighlight(page);

  await page.goto("/resurface");
  await page.getByRole("button", { name: "Remembered this" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByRole("button", { name: "Highlights library" }).click();
  await expect(page.getByRole("button", { name: /^Remembered \(1\)$/ })).toBeVisible();
  await expect(page.getByText(/^Due (today|tomorrow|in \d+ days)$/)).toBeVisible();
});
