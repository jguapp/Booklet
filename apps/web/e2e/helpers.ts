import type { Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 4321}`;

/**
 * URLs for the local fixture server (see e2e/fixture-server/server.mjs),
 * started automatically by playwright.config.ts's `webServer`.
 *
 * Saved instead of a real Wikipedia URL. Almost none of the specs that save
 * an article are testing extraction -- they need an article to *exist* so
 * they can test collections, trash, tags, highlights, and so on -- and doing
 * that over the real network made each one a live fetch plus a full
 * Readability pass, serialized behind a single Playwright worker. It also
 * made those specs quietly dependent on the contents of a page anyone can
 * edit.
 *
 * Real-world extraction is still covered: save-real-url.spec.ts deliberately
 * fetches a genuine public URL.
 */
export const FIXTURES = {
  /** The default article. Ordinary shape -- short opening sentence, a few
   * normal paragraphs. Use this unless a spec needs something specific. */
  article: `${FIXTURE_ORIGIN}/readability.html`,
  /** A second, clearly distinct article -- for specs that need two saves
   * (duplicate detection, tag filtering, collection membership). */
  secondArticle: `${FIXTURE_ORIGIN}/tagging.html`,
  /** Opens with a single sentence far longer than the TTS first-chunk cap. */
  longOpeningSentence: `${FIXTURE_ORIGIN}/long-opening-sentence.html`,
  /** ~40 paragraphs -- scroll progress, reading-time estimates, chunk counts. */
  longArticle: `${FIXTURE_ORIGIN}/long-article.html`,
  /** Returns 404, for asserting the app's own save-failure handling. */
  notFound: `${FIXTURE_ORIGIN}/not-an-article.html`,
} as const;

/**
 * Waits for the save-article modal to actually close. The naive
 * `getByRole("button", { name: /save article/i })).toBeVisible()` looks
 * right but isn't: that's the Library page's own button that opens the
 * modal, and it's always present (just visually covered by the modal's
 * backdrop) whether or not the save has finished -- so it never actually
 * gates on anything, and once let through, tests can go on to assert
 * against a still-in-flight save. Wait for the modal's heading to
 * disappear instead.
 */
export async function waitForSaveModalToClose(page: Page): Promise<void> {
  await page.getByRole("heading", { name: /save an article/i }).waitFor({ state: "hidden", timeout: 20_000 });
}
