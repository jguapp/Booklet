import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * The client-side audio cache's one criterion that only a real browser can
 * answer (#150): a second play of the same article makes no network request
 * at all.
 *
 * Deliberately @live and unstubbed. The first attempt at this feature was
 * reverted precisely because it was verified against a Playwright
 * `route.fulfill()`ed response, and the remaining unexplained hypothesis was
 * that such a Blob doesn't survive a structured clone into IndexedDB the way a
 * real network Blob does -- i.e. the harness, not the implementation, may have
 * been what was broken. Stubbing here would reproduce that exact blind spot.
 *
 * Same-session replay, never across a reload -- also per the issue's own
 * notes: device preferences hydrate from localStorage in an effect, so
 * immediately after a reload the selected voice is still `system` and playback
 * routes to SpeechSynthesis, exercising none of this.
 */
test("@live a second play of the same article is served entirely from the client-side cache", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/settings/reading");
  await page.getByRole("combobox", { name: "Read-aloud voice" }).selectOption({ value: "af_heart" });

  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("http://127.0.0.1:4321/long-opening-sentence.html");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  await page.locator("a[href^='/reader/']").first().click();
  await expect(page).toHaveURL(/\/reader\//);

  // The chunk *texts* requested, not merely a count.
  //
  // A count alone cannot distinguish the two things a replay does: re-fetching
  // audio it should have had cached (the bug this feature exists to prevent),
  // and fetching chunks further into the article than the first play ever
  // reached (correct -- nothing cached them). Playing a real article to
  // completion just to make a bare count meaningful would mean minutes of
  // real generation per run. Comparing texts tests the actual claim directly:
  // nothing already fetched is ever fetched twice.
  let requested: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/tts")) return;
    try {
      const body = JSON.parse(req.postData() ?? "{}");
      // /api/tts sends one `text`; /api/tts/warm sends `texts`.
      if (typeof body.text === "string") requested.push(body.text);
      if (Array.isArray(body.texts)) requested.push(...body.texts.filter((t: unknown) => typeof t === "string"));
    } catch {
      /* An unparseable body would be a different bug; don't mask it as a miss. */
    }
  });

  await page.getByTitle("Read aloud").click();
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 120_000 });
  // Let the play loop get a little way in, so more than just chunk 0 has been
  // fetched and written -- a one-chunk cache would pass a weaker version of
  // this test without proving much.
  await expect(page.locator("[data-reading-word]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6_000);

  const firstPlayTexts = new Set(requested);
  // Guards against the whole test passing vacuously: if the first play fetched
  // nothing, nothing was ever cached and "no refetch" is trivially true.
  expect(firstPlayTexts.size).toBeGreaterThan(0);

  await page.getByTitle("Stop reading aloud").click();
  await expect(page.getByTitle("Read aloud")).toBeVisible();

  requested = [];
  await page.getByTitle("Read aloud").click();
  await expect(page.getByTitle("Pause reading aloud")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-reading-word]").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6_000);

  // Anything the replay fetched that the first play had already fetched is a
  // cache miss on audio that was definitely stored -- the exact failure that
  // got the first implementation reverted.
  const refetched = requested.filter((text) => firstPlayTexts.has(text));
  expect(
    refetched,
    `the replay re-fetched ${refetched.length} chunk(s) that the first play had already cached`,
  ).toEqual([]);

  // The cache is only worth having if it is also fast -- a replay's TTFA
  // should be decode cost, not generation cost. Loose bound on purpose: this
  // asserts "no longer waiting on a server", not a specific number.
  const replayTtfa = await page.evaluate(() => window.__ttsMetrics?.at(-1)?.ttfaMs ?? null);
  expect(replayTtfa).not.toBeNull();
  expect(replayTtfa!).toBeLessThan(2_000);
});
