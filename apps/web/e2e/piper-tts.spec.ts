import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Piper (lib/reader/piper-tts.ts) -- the open-source, client-side TTS voice
 * option, running entirely in-browser via onnxruntime-web's WASM backend
 * (it never requests WebGPU -- confirmed by reading @mintplex-labs/piper-
 * tts-web's own source, its InferenceSession.create() call passes no
 * executionProviders option at all, so this doesn't carry the WebGPU
 * numerical-corruption risk Kokoro's TTS had on this same stack). Unlike
 * the native SpeechSynthesis path (see text-to-speech.spec.ts, which has to
 * skip on headless Linux CI for lack of installed system voices), this
 * works the same in headless CI as on a real desktop -- it doesn't ask the
 * OS for anything.
 *
 * The first play genuinely downloads that voice's ~60MB model from Hugging
 * Face's CDN rather than mocking it, so this is allowed a generous timeout
 * instead of a tight one.
 */

// Real speech is neither silent nor a flat DC offset; a broken pipeline
// (predict() resolving with an empty/garbage buffer, wrong sample rate,
// etc.) tends to produce exactly one of those instead of something that
// merely sounds different. Checking that HTMLMediaElement.play() merely
// resolved (as this test did before) can't tell "played real audio" apart
// from "played a technically-valid but silent/garbage WAV."
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

    // piper-tts-web's predict() encodes to 16-bit PCM WAV (audio/x-wav),
    // not Kokoro's 32-bit float WAV -- see pcm2wav() in the package's own
    // source, which also clamps any out-of-range float into valid int16
    // before this point, so (unlike the old Kokoro test) an amplitude check
    // here can't distinguish "correct" from "corrupted-then-clamped." What
    // it *can* still catch: a pipeline bug that produces silence or a flat
    // buffer instead of varying samples.
    (window as unknown as { __audioNonSilentRatios: number[] }).__audioNonSilentRatios = [];
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === "audio/x-wav") {
        obj.arrayBuffer().then((buf) => {
          const view = new DataView(buf);
          let nonSilent = 0;
          let total = 0;
          for (let i = 44; i + 2 <= buf.byteLength; i += 2) {
            total++;
            if (Math.abs(view.getInt16(i, true)) > 200) nonSilent++; // ignore quantization/dither noise near zero
          }
          (window as unknown as { __audioNonSilentRatios: number[] }).__audioNonSilentRatios.push(
            total > 0 ? nonSilent / total : 0,
          );
        });
      }
      return origCreateObjectURL(obj);
    };
  });
}

test("selecting a Piper voice and pressing play actually generates and plays real (not silent) audio", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // use-text-to-speech.ts plays Piper chunks through `new Audio(url)` -- a
  // real, playing element, but deliberately never attached to the DOM
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

  const ratios = await page.evaluate(
    () => (window as unknown as { __audioNonSilentRatios: number[] }).__audioNonSilentRatios,
  );
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) {
    expect(ratio).toBeGreaterThan(0.1); // real speech, not silence or a near-flat buffer
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

  // General end-to-end regression guard: piper-tts.ts pre-chunks text
  // itself (toSafeTextChunks) rather than handing Piper's one-shot
  // predict() a whole article at once, specifically so a long, irregularly-
  // punctuated tail (bare URLs, list items, no terminal punctuation, as in
  // this article's "External links" section) can't stall generation. Kept
  // as a real end-to-end check with a real article rather than a unit test
  // of the chunker alone, since the original bug this class of test guards
  // against (kokoro-js's TextSplitterStream hanging on exactly this kind of
  // input) only ever showed up with real extracted article text.
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
  // is bounded by real generation time, not a fresh ~60MB download.
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 120_000 });

  await page.getByTitle("Stop reading aloud").click();
});
