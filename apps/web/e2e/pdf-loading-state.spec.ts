import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Authenticated mode has no local copy of a PDF/EPUB's original file --
 * opening the reader always has a real network gap before the real
 * (page/CFI) reader can render (see reader-view.tsx's fileLoadStatus).
 * Regression coverage for that gap never showing the plain extracted-text
 * fallback, which used to be indistinguishable from "there's no real file
 * here" -- see the issue this fixed for the "messy flash" report.
 */

const SAMPLE_PDF = path.join(process.cwd(), "e2e", "fixtures", "sample.pdf");

test("opening a PDF shows a loading state, never the extracted-text fallback, while the real file is in flight", async ({
  page,
}) => {
  const email = `pdf-loading-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("PDF Loading Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(SAMPLE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const href = await page.locator("a[href^='/reader/']").first().getAttribute("href");
  expect(href).toBeTruthy();

  // Real (server) network latency for the auth-gated file route -- everything
  // else on the page (article metadata, the extracted-text data itself) is
  // already loaded by this point, only the raw file is delayed.
  await page.route("**/api/articles/*/file", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });

  await page.goto(href!);
  await expect(page.getByText("Loading the original PDF…")).toBeVisible();
  await expect(page.locator("text=shown as extracted text")).toHaveCount(0);

  // Once the delayed file arrives, the real reader takes over.
  await expect(page.locator('[class*="textLayer"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Loading the original PDF…")).toHaveCount(0);
  await expect(page.locator("text=shown as extracted text")).toHaveCount(0);
});

test("re-opening a previously-viewed PDF doesn't re-download the file", async ({ page }) => {
  const email = `pdf-cache-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("PDF Cache Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });

  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByRole("button", { name: /upload a file/i }).click();
  await page.locator("input[type='file']").setInputFiles(SAMPLE_PDF);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  let fileRequests = 0;
  page.on("request", (req) => {
    if (/\/api\/articles\/.*\/file/.test(req.url())) fileRequests++;
  });

  // Client-side (<Link>) navigation both times, matching how a real user
  // moves between library and reader -- the in-memory cache lives in a JS
  // module and only survives the SPA session, not a hard page load, so this
  // is the case it's actually meant to speed up (see the Cache-Control
  // header on the API route itself for the hard-reload case).
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator('[class*="textLayer"]').first()).toBeVisible({ timeout: 10_000 });
  expect(fileRequests).toBe(1);

  await page.locator('a[title="Back to library"]').click();
  await page.waitForURL(/\/library/);
  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);
  await expect(page.locator('[class*="textLayer"]').first()).toBeVisible({ timeout: 10_000 });
  expect(fileRequests).toBe(1); // still 1 -- the second open served from the in-memory cache
});
