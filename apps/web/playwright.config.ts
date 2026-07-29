import { defineConfig, devices } from "@playwright/test";

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
