import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Kokoro (lib/reader/kokoro-tts.ts) -- the open-source, client-side TTS
 * voice option, running entirely in-browser via WASM (WebGPU is
 * deliberately never used -- see kokoro-tts.ts's DEVICE comment) with no
 * system-TTS dependency. Unlike the native SpeechSynthesis path (see
 * text-to-speech.spec.ts, which has to skip on headless Linux CI for lack
 * of installed system voices), this works the same in headless CI as on a
 * real desktop -- it doesn't ask the OS for anything.
 *
 * The first play genuinely downloads the ~90MB quantized model from
 * Hugging Face's CDN rather than mocking it, so this is allowed a generous
 * timeout instead of a tight one.
 */

// Real, valid speech samples stay within [-1, 1]; a corrupted-inference
// bug (the actual "loads forever, then a burst of static" symptom this
// guards against -- WebGPU produced samples up to ~10^26 for this exact
// model) blows samples up to an enormous, easily-distinguishable
// magnitude. Checking that HTMLMediaElement.play() merely resolved (as
// this test did before) can't tell the two apart -- a garbage WAV plays
// "successfully" too, it just sounds like static.
async function instrumentAudioCapture(page: import("@playwright/test").Page) {
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

    (window as unknown as { __audioMaxAbs: number[] }).__audioMaxAbs = [];
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === "audio/wav") {
        obj.arrayBuffer().then((buf) => {
          const view = new DataView(buf);
          let maxAbs = 0;
          for (let i = 44; i + 4 <= buf.byteLength; i += 4) {
            const v = view.getFloat32(i, true);
            if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
          }
          (window as unknown as { __audioMaxAbs: number[] }).__audioMaxAbs.push(maxAbs);
        });
      }
      return origCreateObjectURL(obj);
    };
  });
}

test("selecting a Kokoro voice and pressing play actually generates and plays real (not corrupted) audio", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // use-text-to-speech.ts plays Kokoro chunks through `new Audio(url)` --
  // a real, playing element, but deliberately never attached to the DOM
  // (nothing needs to render it), so `document.querySelectorAll("audio")`
  // can never see it. Instrument the real play() call instead of querying
  // the DOM for evidence that audio genuinely started (not just that the
  // UI *claims* "playing").
  await instrumentAudioCapture(page);

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

  // Regression guard for a real bug found by hand: onnxruntime-web's
  // WebGPU backend produced numerically-corrupted inference output for
  // this model (samples up to ~10^26, real speech stays within [-1, 1]) --
  // played through <audio>, that's exactly "loads forever, then a burst of
  // static." kokoro-tts.ts now never requests WebGPU, but this asserts on
  // the actual generated samples so a regression (a future dependency bump
  // re-enabling it, say) fails loudly here instead of shipping silently.
  const maxAbsValues = await page.evaluate(() => (window as unknown as { __audioMaxAbs: number[] }).__audioMaxAbs);
  expect(maxAbsValues.length).toBeGreaterThan(0);
  for (const maxAbs of maxAbsValues) {
    expect(maxAbs).toBeLessThanOrEqual(1.5); // real audio; garbage inference is orders of magnitude larger
    expect(maxAbs).toBeGreaterThan(0); // not dead silence either
  }

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
