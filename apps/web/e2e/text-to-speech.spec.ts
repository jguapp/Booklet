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

  // The SpeechSynthesis *API surface* existing (window.speechSynthesis,
  // SpeechSynthesisUtterance) doesn't mean synthesis actually works --
  // headless Linux CI runners typically have no system TTS voices
  // installed, so speak() never reaches "speaking" even though nothing
  // throws. Skip rather than fail somewhere that structurally can't
  // exercise the feature; this ran and passed for real locally (a real
  // desktop Chromium with a real voice) -- see the commit that added this.
  const ttsWorks = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        if (!("speechSynthesis" in window)) return resolve(false);
        const utterance = new SpeechSynthesisUtterance("test");
        const timeout = setTimeout(() => resolve(false), 2000);
        utterance.onstart = () => {
          clearTimeout(timeout);
          window.speechSynthesis.cancel();
          resolve(true);
        };
        utterance.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
        window.speechSynthesis.speak(utterance);
      }),
  );
  test.skip(!ttsWorks, "No working speech-synthesis backend in this environment (no system TTS voices)");

  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/readability.html");
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
