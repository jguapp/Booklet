import { defineConfig, devices } from "@playwright/test";

/**
 * The `@live` tag marks every test that genuinely reaches the public
 * internet, so `--grep-invert @live` gives a suite that runs offline:
 *
 *   pnpm --filter @booklet/web test:e2e -- --grep-invert @live
 *
 * That is the whole point of the tag, and for a while it did not hold. Only
 * save-real-url.spec.ts carried it, while six other tests quietly needed a
 * network -- xkcd's RSS feed, dictionaryapi.dev, and Hugging Face for the
 * Kokoro weights -- so excluding `@live` still left a suite that failed
 * without egress. All seven are tagged now (see #167).
 *
 * Tag a test if it contacts a host this repo does not control. Do not tag one
 * that only talks to the fixture server on 127.0.0.1: three of rss.spec.ts's
 * four tests are tagged and the fourth is not, precisely because it points at
 * a fixture URL to assert the not-a-feed error path.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Every spec here drives a real Next.js dev server (Turbopack compiling
  // routes on first hit) and, for several, a real network fetch -- multiple
  // spec files racing that shared dev server concurrently is exactly what
  // was causing intermittent failures (a stale/duplicate iframe, a
  // navigation that silently didn't happen yet, a scroll position that
  // hadn't landed) on CI's more constrained runners specifically; it's not
  // that any single test is flaky in isolation. fullyParallel: false above
  // already stops tests *within* one file from racing each other; this
  // stops different files from doing the cross-file version of the same
  // thing.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  // Serves the article fixtures the suite saves instead of fetching a real
  // page off the internet for every spec that just needs an article to
  // exist. See e2e/fixture-server/server.mjs for the full reasoning; the
  // short version is that 31 of these specs were doing a live network fetch
  // plus a full extraction as *setup*, serialized behind one worker, which
  // is what made this job slow enough to be disabled in CI.
  //
  // Playwright starts and stops it around the run, and reuses an already-
  // running one locally so a watch loop doesn't fight for the port.
  webServer: {
    command: "node e2e/fixture-server/server.mjs",
    url: `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 4321}/readability.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
