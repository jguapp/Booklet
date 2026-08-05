import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Kokoro (lib/reader/kokoro-tts.ts) generation moved server-side (apps/api's
 * POST /api/tts, via kokoro-js + onnxruntime-node) -- WASM-in-browser
 * generation, real per-chunk here, took 12-18s regardless of what was tried
 * client-side (Worker-based pipelining, quantization, threading); native
 * Node execution measured at ~4.7s for the same sentence on the same
 * machine. This suite covers the server-side path plus the global,
 * Spotify/Readwise-style player it now drives (tts-player-provider.tsx,
 * tts-player-bar.tsx) -- persisting across navigation, read-along
 * highlighting -- none of which existed in the old WASM-only version of
 * this suite.
 *
 * Real generation, not mocked -- allowed a generous timeout instead of a
 * tight one, same reasoning as the old version of this suite had for a real
 * model download.
 */

test("selecting a Kokoro voice and pressing play actually generates and plays real audio, with a persistent player bar and read-along highlighting", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/settings/reading");
  await page.getByRole("combobox", { name: "Read-aloud voice" }).selectOption({ value: "af_heart" });

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Dog");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Read aloud").click();
  // Real server-side generation for the first chunk -- genuinely a few to
  // several real seconds (see tts-service.ts), hence the generous timeout
  // instead of the suite's usual few seconds.
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 60_000 });

  // The persistent player bar (tts-player-bar.tsx) should show up
  // app-wide, not just as an in-reader control -- this is the actual
  // "Spotify-style" requirement, not just "TTS makes noise."
  const playerBar = page.getByRole("region", { name: "Read-aloud player" });
  await expect(playerBar).toBeVisible();
  await expect(playerBar).toContainText("Dog");
  // Spotify-style progress bar, not "Sentence X of Y" text -- see
  // tts-player-bar.tsx's own comment on the progressbar's data-* attrs.
  await expect(page.getByRole("progressbar", { name: "Reading progress" })).toBeVisible();

  // Read-along: the word currently being spoken should be highlighted in
  // the actual rendered article -- a positioned overlay (article-content.tsx's
  // reading-word divs), not a wrapped <mark>, see that file's own comment
  // for why (it updates several times a second, driven by audio playback
  // position, so it can't risk repeatedly mutating the article's own DOM
  // text nodes the way the old sentence-level highlight did).
  await expect(page.locator("[data-reading-word]").first()).toBeVisible({ timeout: 15_000 });

  // Readwise-style: a left-edge bar on whichever paragraph the TTS bot is
  // currently on (article-content.tsx's nearestSectionEl), a coarser,
  // steadier anchor than the word cursor above.
  await expect(page.locator(".reading-section-active").first()).toBeVisible();

  // The player must survive real (SPA) navigation away from the article --
  // the entire point of it living in the root layout instead of the reader
  // page's own component tree. goBack(), not page.goto(): a hard navigation
  // would remount the whole app and trivially "pass" this by accident.
  await page.goBack();
  await expect(page).toHaveURL(/\/library/);
  await expect(playerBar).toBeVisible();
  await expect(page.getByTitle("Pause")).toBeVisible();

  // Volume and voice controls are reachable from the player bar itself --
  // without navigating back into the article or into Settings.
  await expect(page.getByRole("slider", { name: "Volume" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Read-aloud voice" })).toBeVisible();

  await page.getByTitle("Stop").click();
  await expect(playerBar).not.toBeVisible();
});

test("the system voice is the default, and switching back to it needs no generation", async ({ page }) => {
  await page.goto("/settings/reading");
  await expect(page.getByRole("combobox", { name: "Read-aloud voice" })).toHaveValue("system");
});

test("a real, full-length article with dense infobox/citation content doesn't blow up the chunk count", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Regression test for a real bug found by hand: toSafeTextChunks used to
  // reset its accumulator at every newline, so a real Wikipedia article's
  // infobox/taxonomy content -- hundreds of newline-separated one-to-few-
  // character fragments with no real sentence punctuation (geological-
  // period abbreviations, binomial-nomenclature citations) -- each became
  // its own chunk: 2283 chunks for this exact article, most under 20
  // characters, meaning 2283 separate server round trips before "read
  // aloud" finished a single page. Fixed by accumulating across paragraph
  // boundaries instead of resetting at each one (see that function's own
  // comment) -- confirmed by hand this brought the same article down to
  // ~430 chunks. This test only checks that playback starts and the
  // reported chunk count is sane, not the exact number (real extracted
  // text length can shift over time as the source page is edited).
  await page.goto("/settings/reading");
  await page.getByRole("combobox", { name: "Read-aloud voice" }).selectOption({ value: "af_heart" });

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Dog");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  await page.getByTitle("Read aloud").click();
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 60_000 });

  const playerBar = page.getByRole("region", { name: "Read-aloud player" });
  // "Sentence X of Y" text was replaced by a visual progress bar (see
  // tts-player-bar.tsx) -- the chunk count itself still lives in a data-*
  // attribute on that same element specifically so this regression guard
  // doesn't need visible text back just to stay testable.
  const totalChunksAttr = await page.getByRole("progressbar", { name: "Reading progress" }).getAttribute("data-total-chunks");
  expect(totalChunksAttr).not.toBeNull();
  const totalChunks = Number(totalChunksAttr);
  // A real, heavily-cited Wikipedia article legitimately has a few hundred
  // sentence-sized chunks -- the regression this guards against was
  // thousands, from one-character fragments never getting grouped at all.
  expect(totalChunks).toBeLessThan(1000);

  // Scoped to the player bar, not page-wide getByTitle("Stop") -- a
  // citation-heavy real article's own markup has plenty of unrelated
  // title="..." attributes (reference metadata, external links) whose
  // values can coincidentally contain "stop" as a substring.
  await playerBar.getByRole("button", { name: "Stop", exact: true }).click();
});
