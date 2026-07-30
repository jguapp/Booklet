import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Kokoro (lib/reader/kokoro-tts.ts) -- the open-source, client-side TTS
 * voice option, running entirely in-browser via WASM/WebGPU with no
 * system-TTS dependency. Unlike the native SpeechSynthesis path (see
 * text-to-speech.spec.ts, which has to skip on headless Linux CI for lack
 * of installed system voices), this works the same in headless CI as on a
 * real desktop -- it doesn't ask the OS for anything.
 *
 * The first play genuinely downloads the ~90MB quantized model from
 * Hugging Face's CDN rather than mocking it, so this is allowed a generous
 * timeout instead of a tight one.
 */

test("selecting a Kokoro voice and pressing play actually generates and plays real audio", async ({ page }) => {
  test.setTimeout(180_000);

  // use-text-to-speech.ts plays Kokoro chunks through `new Audio(url)` --
  // a real, playing element, but deliberately never attached to the DOM
  // (nothing needs to render it), so `document.querySelectorAll("audio")`
  // can never see it. Instrument the real play() call instead of querying
  // the DOM for evidence that audio genuinely started (not just that the
  // UI *claims* "playing").
  await page.addInitScript(() => {
    (window as unknown as { __playCount: number }).__playCount = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
      const result = originalPlay.apply(this, args);
      result.then(() => {
        (window as unknown as { __playCount: number }).__playCount++;
      });
      return result;
    };
  });

  await page.goto("/settings/reading");
  await page.getByRole("combobox", { name: "Read-aloud voice" }).selectOption({ label: "Heart (American, female)" });

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Dog");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Read aloud").click();
  await expect(page.getByTitle("Loading voice…")).toBeVisible();
  // Model download + WASM init -- genuinely slow the first time, hence the
  // generous timeout instead of the suite's usual few seconds.
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 150_000 });

  // The real HTMLMediaElement.play() call must have actually resolved
  // (not been rejected by autoplay policy, not silently caught and
  // skipped) -- see the addInitScript instrumentation above.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __playCount: number }).__playCount), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  await page.getByTitle("Stop reading aloud").click();
  await expect(page.getByTitle("Read aloud")).toBeVisible();
});

test("the system voice is the default, and switching back to it needs no download", async ({ page }) => {
  await page.goto("/settings/reading");
  await expect(page.getByRole("combobox", { name: "Read-aloud voice" })).toHaveValue("system");
});

test("a real, full-length article with an external-links/citations tail doesn't hang forever", async ({ page }) => {
  test.setTimeout(180_000);

  // Regression test for a real bug found by hand: kokoro-js's own
  // TextSplitterStream.push(), handed a whole article's text (tens of
  // thousands of characters) in one call instead of one sentence at a
  // time, could loop forever and never return -- confirmed in complete
  // isolation (a plain Node script, no browser/WASM/GPU involved at all)
  // using this exact Wikipedia article's extracted text, which triggered
  // it specifically in its "External links" tail (bare URLs, list items,
  // no terminal punctuation). That hang blocked the main thread hard
  // enough to eventually crash the tab. Fixed by pre-chunking text
  // ourselves (kokoro-tts.ts's toSafeTextStream) instead of handing
  // kokoro-js one giant blob. The "Dog" article used in the test above
  // never happened to trigger this, so it alone wouldn't have caught this.
  await page.goto("/settings/reading");
  await page.getByRole("combobox", { name: "Read-aloud voice" }).selectOption({ label: "Heart (American, female)" });

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Read aloud").click();
  // The model's already cached from the earlier test in this file, so this
  // is bounded by real generation time, not a fresh ~90MB download --
  // before the fix, this never resolved at all (confirmed hanging past
  // 170s in manual testing) rather than just being slow.
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 120_000 });

  await page.getByTitle("Stop reading aloud").click();
});
