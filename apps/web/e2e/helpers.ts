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
/**
 * `@live` in a test title means it needs the public internet, and
 * `--grep-invert @live` is meant to be a genuine offline switch:
 *
 *   pnpm --filter @booklet/web test:e2e --grep-invert @live
 *
 * That was only aspirational before -- #148 tagged one spec and moved the
 * article saves onto the fixture server, but rss.spec.ts (xkcd),
 * dictionary-lookup.spec.ts (dictionaryapi.dev) and tts-player.spec.ts
 * (Kokoro weights from Hugging Face) all still reached out untagged, so the
 * exclusion left seven specs that would fail anyway (#167). RSS is now served
 * locally; the rest carry the tag.
 *
 * Keep it accurate: a spec that starts needing a public host needs the tag, or
 * the switch quietly stops meaning anything again.
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
  /** A real RSS 2.0 document, fetched and parsed for real by rss-service.ts.
   * Its items link back at this same server, so saving one exercises real
   * extraction too. */
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
 * the reader listens for, returning the selected text.
 *
 * The wait matters and is the whole reason this is shared. pdf.js renders a
 * page's canvas and its selectable text layer separately, so the text layer
 * can lag whatever a spec waited on to decide the page was ready -- without
 * waiting for a real span, the evaluate below throws "no text layer span to
 * select" on whichever run loses the race. That fired for real in CI, failing
 * highlight-citations.spec.ts twice in a row.
 *
 * Four spec files had their own copy of this, two of which were missing the
 * wait; fixing them one at a time is exactly how the next copy rots (#167).
 * Waiting is the right fix rather than a retry: a reader cannot select text
 * that hasn't rendered either, so there is nothing for the product to do
 * differently.
 *
 * `containerSelector` scopes both the wait and the selection to one page's
 * container, which continuous-scroll mode needs since every page's text layer
 * is in the DOM at once.
 */
export async function selectFirstTextLayerSpan(page: Page, containerSelector?: string): Promise<string> {
  const scope = containerSelector ? `${containerSelector} ` : "";
  await page.locator(`${scope}[class*="textLayer"] span`).first().waitFor({ state: "attached", timeout: 15_000 });

  return page.evaluate((selector) => {
    const container: ParentNode = selector ? document.querySelector(selector)! : document;
    const span = container.querySelector('[class*="textLayer"] span');
    if (!span?.firstChild) throw new Error("no text layer span to select");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, span.firstChild.textContent!.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Dispatched on the scoped container when there is one (the reader listens
    // per page in scroll mode), otherwise on the text layer itself.
    const target = selector ? (container as Element) : span.closest('[class*="textLayer"]')!;
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return range.toString();
  }, containerSelector ?? null);
}
