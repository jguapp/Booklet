import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Tags, full-text search, and reading-progress persistence -- all local/
 * anonymous mode (IndexedDB), same as the rest of this e2e suite. Uses
 * real Wikipedia saves rather than fixtures since the point is exercising
 * the real extraction -> full text -> search pipeline, not a stub.
 */

async function saveUrl(page: import("@playwright/test").Page, url: string) {
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("heading", { name: /save an article/i }).waitFor();
  await page.getByPlaceholder(/example\.com/).fill(url);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
}

test("tag an article, filter the library by tag, and see it persist", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Tag_(metadata)");

  await page.locator("a[href^='/reader/']").first().click();
  await page.waitForURL(/\/reader\//);
  const tagInput = page.getByPlaceholder(/add a tag/i);
  await tagInput.waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");

  await tagInput.fill("reference");
  await tagInput.press("Enter");
  await expect(page.locator('button[title^="Remove"]')).toHaveText(["reference×"]);

  await page.reload();
  await expect(page.locator('button[title^="Remove"]')).toHaveText(["reference×"], { timeout: 10_000 });

  // The library defaults to the "Unread" tab, and the tagged article is
  // UNREAD, so it's visible with no tab switch needed.
  await page.goto("/library");
  await expect(page.getByRole("button", { name: "reference" })).toBeVisible();
  await page.getByRole("button", { name: "reference" }).click();
  await expect(page.getByText("Tag (metadata)")).toBeVisible();
});

test("library defaults to the Unread tab, showing a fresh save immediately", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Readability");
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);

  // A fresh navigation confirms this isn't just leftover client state --
  // the default tab itself shows the just-saved (UNREAD) article.
  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Unread", exact: true })).toHaveClass(/bg-accent\b/);
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);

  // Marking it Reading moves it out of the default Unread view.
  await page.locator("a[href^='/reader/']").first().click();
  await page.waitForURL(/\/reader\//);
  await page.getByRole("button", { name: "Reading", exact: true }).click(); // reader-view.tsx's own status tabs

  await page.goto("/library");
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator("a[href^='/reader/']")).toHaveCount(1);
});

test("full-text search finds an article by body text, not just its title", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Full-text_search");

  const search = page.getByPlaceholder(/search titles, text, notes/i);
  await search.fill("a single computer-stored document");
  await expect(page.getByText("Full-text search", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

  await search.fill("this phrase should not appear anywhere in that article");
  await expect(page.getByText("No articles match that search.")).toBeVisible();
});

test("reading progress persists across a reload and resumes scroll position", async ({ page }) => {
  await page.goto("/library");
  await saveUrl(page, "https://en.wikipedia.org/wiki/Tag_(metadata)"); // long article -- actually scrollable

  await page.locator("a[href^='/reader/']").first().click();
  await page.waitForURL(/\/reader\//);
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(600); // let the scroll handler update React state

  // A hard navigation/tab-close can interrupt an in-flight async
  // IndexedDB write before React's unmount cleanup finishes it (this is
  // exactly why reader-view.tsx also flushes on visibilitychange, not
  // just on unmount) -- simulate that directly rather than depending on
  // exact navigation timing to trigger it incidentally.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800); // resume-scroll effect runs one animation frame after mount

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(500);
});
