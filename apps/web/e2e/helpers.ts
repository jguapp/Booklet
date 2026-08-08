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
  /** A local RSS feed served by the fixture server, so the rss specs never
   * touch a live third-party feed (#148/#167). */
  feed: `${FIXTURE_ORIGIN}/feed.xml`,
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

/**
 * Selects the first span of a rendered PDF text layer and fires the mouseup
 * the reader listens for, returning the text that ended up selected.
 *
 * The wait is the whole point. pdf.js renders a page's canvas and its
 * selectable text layer separately, so the text layer lags whatever a spec
 * waited on to decide the page was ready -- a page indicator, a canvas, a
 * page-slot count. Any copy that skips the wait throws "no text layer span
 * to select" on whichever run loses that race, which is not hypothetical:
 * it failed highlight-citations.spec.ts twice in a row in CI on a spec that
 * had been passing. Waiting rather than retrying is deliberate -- a reader
 * cannot select text that hasn't rendered either, so there is nothing here
 * for the product to do differently.
 *
 * This lived in four separate copies (three named, one inlined twice), and
 * the wait got added to them one at a time as each failed -- which is
 * exactly the pattern that leaves the next copy to rot until it costs
 * another red CI run to find. See #167.
 *
 * `containerSelector` scopes both the wait and the query, for continuous-
 * scroll mode where every page slot has its own text layer and "the first
 * one on the page" is not the one the spec means. The mouseup is dispatched
 * on the layer rather than the container in every case: it bubbles, so a
 * listener on either still sees it, and the layer is the element that
 * exists in both shapes.
 */
export async function selectFirstTextLayerSpan(page: Page, containerSelector?: string): Promise<string> {
  const scope = containerSelector ? `${containerSelector} ` : "";
  await page.locator(`${scope}[class*="textLayer"] span`).first().waitFor({ state: "attached", timeout: 15_000 });

  return page.evaluate((selector) => {
    const layer = document.querySelector(selector ? `${selector} [class*="textLayer"]` : '[class*="textLayer"]');
    const span = layer?.querySelector("span");
    if (!span?.firstChild) throw new Error("no text layer span to select");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.firstChild.textContent!.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    layer!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.toString();
  }, containerSelector ?? null);
}
