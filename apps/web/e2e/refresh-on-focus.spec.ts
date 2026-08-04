import { expect, test } from "@playwright/test";

/**
 * A save made outside the page currently open in the browser -- the
 * clearest real case being the browser extension (apps/extension), a
 * different origin with no way to reach an already-open library tab's
 * React state directly -- has to show up without the user reloading.
 * useRefreshOnFocus (lib/data/use-refresh-on-focus.ts) covers this by
 * silently refetching when the tab becomes visible/focused again.
 *
 * These sign up a real account through the UI (this only matters in
 * authenticated mode -- local/anonymous mode has no second, independent
 * client that could write to the same library) and then write directly
 * against the API with a fresh access token, exactly the way the
 * extension's background.ts does, rather than going through the page at
 * all.
 *
 * simulateTabSwitchAway/Back stand in for the user actually switching away
 * and back -- the hook only refetches once it has genuinely observed the
 * tab go away first (see use-refresh-on-focus.ts: a bare `focus` with no
 * preceding away-state is what a fresh page load fires too, so it's
 * deliberately ignored). A test that only dispatched `focus` would be
 * asserting on a no-op.
 */

const API_URL = "http://localhost:4000";

async function simulateTabSwitchAway(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function simulateTabSwitchBack(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function signUpAndGetToken(page: import("@playwright/test").Page): Promise<string> {
  const email = `refresh-focus-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "correct horse battery staple";

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Refresh Focus Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // A login separate from the page's own session -- standing in for a
  // wholly different client (the extension) authenticating on its own.
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { accessToken } = (await loginRes.json()) as { accessToken: string };
  return accessToken;
}

test("a save made outside the page appears once the tab regains focus, without a reload", async ({ page }) => {
  const token = await signUpAndGetToken(page);
  await page.waitForTimeout(300);
  // The hook only arms once it has seen the tab actually go away -- a fresh
  // page load's own initial focus doesn't count (see use-refresh-on-focus.ts).
  await simulateTabSwitchAway(page);

  const before = await page.locator("a[href^='/reader/']").count();

  // Bypasses the page entirely -- the same shape of request the extension's
  // one-click save makes, not anything routed through this browser tab.
  const createRes = await fetch(`${API_URL}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: "https://en.wikipedia.org/wiki/Alan_Turing?e2e=" + Date.now() }),
  });
  expect(createRes.status).toBe(201);

  // Confirms this isn't a false positive from some other polling/effect
  // already covering it -- without the fix, the page genuinely doesn't know.
  await page.waitForTimeout(800);
  expect(await page.locator("a[href^='/reader/']").count()).toBe(before);

  await simulateTabSwitchBack(page);

  await expect(page.locator("a[href^='/reader/']")).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(page.getByText("Alan Turing", { exact: false }).first()).toBeVisible();
});

test("the same holds for highlights imported outside the page (the extension's Open in Booklet flow)", async ({
  page,
}) => {
  const token = await signUpAndGetToken(page);

  const articleRes = await fetch(`${API_URL}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: "https://en.wikipedia.org/wiki/Reading" }),
  });
  const article = await articleRes.json();

  await page.goto("/highlights");
  await page.waitForTimeout(300);
  await simulateTabSwitchAway(page);
  const distinctiveText = page.getByText("a distinctive test phrase for refresh-on-focus", { exact: false });
  await expect(distinctiveText).toHaveCount(0);

  const highlightRes = await fetch(`${API_URL}/api/highlights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      articleId: article.id,
      selectedText: "a distinctive test phrase for refresh-on-focus",
      position: {
        type: "text",
        exact: "a distinctive test phrase for refresh-on-focus",
        prefix: "",
        suffix: "",
        start: 0,
        end: 10,
      },
      color: "YELLOW",
    }),
  });
  expect(highlightRes.status).toBe(201);

  await simulateTabSwitchBack(page);

  await expect(distinctiveText).toBeVisible({ timeout: 15_000 });
});
