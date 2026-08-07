import { expect, test } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Regression coverage for the highlight-anchoring pass in article-content.tsx
 * scaling with highlights x document size instead of highlights + document
 * size (see the issue this fixed for the root-cause diagnosis and an
 * isolated, dev-server-noise-free benchmark proving the old per-highlight
 * DOM-walk-from-scratch approach was ~9x-56x slower than the shared,
 * sorted, single-pass walk that replaced it). Seeds highlights directly
 * into IndexedDB rather than creating each one through the UI -- doing that
 * for a few hundred highlights would itself take minutes and isn't what
 * this is testing.
 */

const TEST_ARTICLE_URL = "http://127.0.0.1:4321/tagging.html";
const HIGHLIGHT_COUNT = 250;
// Generous relative to the fix's own benchmark (single-digit ms for the
// pure DOM-walk portion at this scale) -- this just needs to catch a real
// regression back toward O(highlights x document size), not hold CI to a
// tight number that'd be flaky under real machine/browser variance.
const MAX_CONTENT_VISIBLE_MS = 6_000;

test("opening an article with hundreds of highlights renders them all promptly", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill(TEST_ARTICLE_URL);
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);

  const href = await page.locator("a[href^='/reader/']").first().getAttribute("href");
  const articleId = href!.split("/").pop()!;

  await page.evaluate(
    async ({ articleId, count }) => {
      const req = indexedDB.open("booklet", 5);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const article = await new Promise<{ extractedText?: string }>((resolve, reject) => {
        const r = db.transaction("articles", "readonly").objectStore("articles").get(articleId);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const text = article?.extractedText ?? "";

      const tx = db.transaction("highlights", "readwrite");
      const store = tx.objectStore("highlights");
      for (let i = 0; i < count; i++) {
        const start = Math.floor((i / count) * Math.max(0, text.length - 10));
        const end = start + 10;
        // exact matches the real text at this offset -- resolveTextPosition's
        // direct fullText.slice(start,end) === exact fast path, same as a
        // real highlight, not the fallback text-search path.
        store.put({
          id: `perf-seed-${i}`,
          articleId,
          userId: "local",
          selectedText: `Seeded highlight ${i}`,
          position: { type: "text", exact: text.slice(start, end), prefix: "", suffix: "", start, end },
          color: "YELLOW",
          lastSurfacedAt: null,
          surfaceCount: 0,
          lastFeedback: null,
          lastFeedbackAt: null,
          resurfaceArchivedAt: null,
          easinessFactor: 2.5,
          intervalDays: 0,
          repetitions: 0,
          nextDueAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { articleId, count: HIGHLIGHT_COUNT },
  );

  const t0 = Date.now();
  await page.goto(href!);
  await page.locator("[data-article-content] p").first().waitFor({ state: "visible", timeout: 30_000 });
  const contentVisibleMs = Date.now() - t0;

  // Correctness, not just speed -- every seeded highlight actually
  // rendered. Distinct highlight-id count, not raw <mark> element count: a
  // single highlight crossing an inline element boundary (a link, <em>,
  // etc., common in real Wikipedia HTML) becomes several marks, one per
  // intersected text node (see wrapRangeInElements's own doc comment).
  const renderedIds = await page.locator("mark[data-highlight-id]").evaluateAll((marks) =>
    Array.from(new Set(marks.map((m) => m.getAttribute("data-highlight-id")))),
  );
  expect(renderedIds.length).toBe(HIGHLIGHT_COUNT);

  expect(contentVisibleMs).toBeLessThan(MAX_CONTENT_VISIBLE_MS);
});
