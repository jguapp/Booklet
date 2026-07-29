import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Read-aloud controls (tts-controls.tsx, lib/reader/use-text-to-speech.ts)
 * against the real browser SpeechSynthesis API -- not mocked. window.speechSynthesis
 * is a native read-only accessor property on most engines, so a plain
 * `window.speechSynthesis = fake` assignment in a test silently no-ops and
 * the app ends up calling the real one anyway; asserting against the real
 * API's own state (speaking/paused) is more honest than fighting that.
 */

test("play, pause, resume, and stop an article being read aloud", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Read aloud").click();
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.speechSynthesis.speaking)).toBe(true);

  await page.getByTitle("Pause reading aloud").click();
  await expect(page.getByTitle("Resume reading aloud")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.speechSynthesis.paused)).toBe(true);

  await page.getByTitle("Resume reading aloud").click();
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible();

  await page.getByTitle("Stop reading aloud").click();
  await expect(page.getByTitle("Read aloud")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.speechSynthesis.speaking)).toBe(false);
});
