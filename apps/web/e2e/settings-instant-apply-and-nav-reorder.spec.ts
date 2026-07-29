import { expect, test, type Page } from "@playwright/test";
import { waitForSaveModalToClose } from "./helpers";

/**
 * Settings used to only take effect after a full page reload -- every
 * consumer read localStorage once on its own mount, and Next's shared
 * (app)/layout.tsx never remounts across sibling client-side navigations,
 * so a change made on /settings was invisible everywhere else until a hard
 * reload remounted the whole tree. Fixed by DevicePrefsProvider (a shared
 * React context, same pattern as ThemeProvider). These tests only use
 * client-side <Link> clicks -- never page.goto -- between the toggle and
 * the check, since a hard navigation would remount everything and pass
 * even with the old bug.
 */

const NAV_ORDER_KEY = "booklet-nav-order";

async function simulateDrag(page: Page, sourceSelector: string, targetSelector: string) {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !target) throw new Error("drag source or target not found");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    },
    { sourceSelector, targetSelector },
  );
}

test("toggling Reading stats in Settings shows/hides the Stats nav item instantly, without a reload", async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page.getByRole("link", { name: "Stats" })).toHaveCount(0);

  await page.locator("nav a[href='/settings']").click();
  await expect(page).toHaveURL(/\/settings/);
  await page.getByRole("group", { name: "Reading stats" }).getByRole("button", { name: "On", exact: true }).click();

  // Client-side nav back to Library -- the app shell (and its sidebar) was
  // never unmounted, so this only passes if the toggle propagated live.
  await page.locator("nav a[href='/library']").click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByRole("link", { name: "Stats" })).toBeVisible();

  await page.locator("nav a[href='/settings']").click();
  await page.getByRole("group", { name: "Reading stats" }).getByRole("button", { name: "Off", exact: true }).click();
  await page.locator("nav a[href='/library']").click();
  await expect(page.getByRole("link", { name: "Stats" })).toHaveCount(0);
});

test("dragging a nav item reorders the sidebar, and the order persists across reload", async ({ page }) => {
  await page.goto("/library");

  const initialOrder = await page
    .locator("nav a")
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")).filter((href) => href && !href.includes("?")));
  expect(initialOrder.slice(0, 2)).toEqual(["/library", "/highlights"]);

  await simulateDrag(page, "nav a[href='/favorites']", "nav a[href='/library']");

  const reordered = await page
    .locator("nav a")
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")).filter((href) => href && !href.includes("?")));
  expect(reordered.slice(0, 3)).toEqual(["/favorites", "/library", "/highlights"]);

  // Persisted to localStorage, not just in-memory state.
  const stored = await page.evaluate((key) => localStorage.getItem(key), NAV_ORDER_KEY);
  expect(stored && JSON.parse(stored)).toEqual(reordered);

  // DevicePrefsProvider renders SERVER_DEFAULTS (navOrder: []) on first
  // paint, same as ThemeProvider -- it only self-corrects once its
  // post-mount effect reads localStorage, so poll rather than reading the
  // DOM the instant reload() resolves.
  await page.reload();
  await expect(async () => {
    const afterReload = await page
      .locator("nav a")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")).filter((href) => href && !href.includes("?")));
    expect(afterReload.slice(0, 3)).toEqual(["/favorites", "/library", "/highlights"]);
  }).toPass({ timeout: 5_000 });
});

test("auto-delete moves unread articles older than the selected period to Trash", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Readability");
  await page.getByRole("button", { name: /^save$/i }).click();
  await waitForSaveModalToClose(page);
  await expect(page.locator("a[href^='/reader/']").first()).toBeVisible();

  // Backdate the saved article well past any of the selectable periods --
  // simulates time passing without an actual multi-week test run.
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("booklet");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("articles", "readwrite");
        const store = tx.objectStore("articles");
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const cutoff = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
          for (const article of getAllReq.result) {
            article.savedAt = cutoff;
            store.put(article);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await page.locator("nav a[href='/settings']").click();
  await expect(page).toHaveURL(/\/settings/);
  await page
    .getByRole("group", { name: "Auto-delete old unread articles" })
    .getByRole("button", { name: "On", exact: true })
    .click();
  await page.getByRole("group", { name: "Auto-delete after" }).getByRole("button", { name: "1 week" }).click();

  // The purge effect lives in the persistent app shell, keyed on the
  // autoDelete prefs -- it fires as soon as the setting changes, with no
  // navigation needed. Poll Library (client-side nav, shell stays mounted)
  // until the stale article is gone.
  await expect(async () => {
    await page.locator("nav a[href='/library']").click();
    await expect(page.locator("a[href^='/reader/']")).toHaveCount(0);
  }).toPass({ timeout: 10_000 });

  await page.locator("nav a[href='/trash']").click();
  await expect(page.getByText("Readability", { exact: true }).first()).toBeVisible();
});
