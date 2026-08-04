import http from "node:http";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

/**
 * Loads the real built extension (dist/, not a mock) into an actual
 * Chromium instance -- the only way to verify a manifest genuinely loads
 * and that chrome.storage/chrome.contextMenus/chrome.action calls succeed
 * against the real API, none of which a unit test can reach.
 *
 * Extensions need a persistent context and, empirically (confirmed here --
 * the background service worker never registers under Chromium's headless
 * mode, with or without --headless=new), a headed browser: this needs a
 * real display (Xvfb on a headless CI runner) to run, unlike the web app's
 * e2e suite. See ../README.md's Verified section for how this is wired
 * into CI as its own job for exactly that reason.
 */

const EXTENSION_PATH = path.join(process.cwd(), "dist");
const API_URL = process.env.BOOKLET_API_URL ?? "http://localhost:4000";

async function launchWithExtension() {
  return chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
}

async function getExtensionId(context: Awaited<ReturnType<typeof launchWithExtension>>): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  return new URL(worker.url()).host;
}

test("manifest loads and registers a background service worker", async () => {
  const context = await launchWithExtension();
  const extensionId = await getExtensionId(context);
  expect(extensionId).toMatch(/^[a-p]{32}$/); // Chrome's extension-id alphabet
  await context.close();
});

test("the toolbar button swaps between one-click save and the login popup", async () => {
  const context = await launchWithExtension();
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });

  // A popup and chrome.action.onClicked are mutually exclusive -- whichever
  // is set wins, and a declared popup means the click event never fires. So
  // this popup/no-popup swap *is* the one-click behaviour; there's no other
  // observable state to assert against.
  await expect
    .poll(() => worker.evaluate(() => chrome.action.getPopup({})), { timeout: 10_000 })
    .toMatch(/popup\.html$/);

  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      booklet_session: {
        accessToken: "not-a-real-token",
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        email: "one-click@example.com",
      },
    });
  });

  // Signing in clears the popup, so the next click saves directly.
  await expect.poll(() => worker.evaluate(() => chrome.action.getPopup({})), { timeout: 10_000 }).toBe("");
  // With no popup, the tooltip is the only place the active account is visible.
  expect(await worker.evaluate(() => chrome.action.getTitle({}))).toContain("one-click@example.com");

  await worker.evaluate(() => chrome.storage.local.remove("booklet_session"));
  await expect
    .poll(() => worker.evaluate(() => chrome.action.getPopup({})), { timeout: 10_000 })
    .toMatch(/popup\.html$/);

  await context.close();
});

test("log in through the popup, then save the active page through the real API", async () => {
  const email = `extension-e2e-${Date.now()}@example.com`;
  const password = "correct horse battery staple";

  const signup = await fetch(`${API_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Extension E2E" }),
  });
  expect(signup.ok).toBe(true);

  const context = await launchWithExtension();
  const extensionId = await getExtensionId(context);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await popup.getByPlaceholder("you@example.com").fill(email);
  await popup.getByPlaceholder("••••••••").fill(password);
  await popup.getByRole("button", { name: "Log in" }).click();

  // A successful login swaps the login form for the "Save this page" view,
  // which only renders once chrome.storage.local has a real session in it.
  await expect(popup.getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 10_000 });

  // page.goto() makes the popup document itself the "active tab" from
  // chrome.tabs' point of view, so driving the real save button here would
  // just exercise the app's own "not a saveable page" guard rather than a
  // real save. Instead, call the same authenticated fetch the button would
  // trigger, directly in the popup's extension-origin context, to confirm
  // the chrome-extension:// origin can actually reach the API (this is what
  // CORS needs to allow explicitly, unlike a normal https:// origin).
  const result = await popup.evaluate(async (apiUrl) => {
    const stored = await chrome.storage.local.get("booklet_session");
    const session = stored.booklet_session as { accessToken: string };
    const res = await fetch(`${apiUrl}/api/articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ url: "https://en.wikipedia.org/wiki/Bookmark_(digital)" }),
    });
    return { status: res.status, body: await res.json() };
  }, API_URL);

  expect(result.status).toBe(201);
  expect(result.body.sourceType).toBe("HTML");

  await context.close();
});

const HIGHLIGHT_TARGET = "Whales are fully aquatic placental marine mammals";

/**
 * A real page served over http:// -- the content script only injects into
 * http(s) documents, so about:blank/data: URLs can't exercise it at all.
 * Enough prose that Readability treats it as an article rather than a stub.
 */
function startArticleServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const body = `<!doctype html><html><head><title>Whale</title></head><body><article>
    <h1>Whale</h1>
    <p id="target">${HIGHLIGHT_TARGET} and a widely distributed and diverse group of
    carnivorous marine mammals that are members of the infraorder Cetacea.</p>
    ${"<p>Whales are creatures of the open ocean and feed, mate, give birth, suckle and raise their young at sea.</p>".repeat(8)}
  </article></body></html>`;

  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/whale`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("highlight a live page, then import it with its highlights", async () => {
  const email = `highlight-e2e-${Date.now()}@example.com`;
  const password = "correct horse battery staple";

  const signup = await fetch(`${API_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Highlight E2E" }),
  });
  expect(signup.ok).toBe(true);
  const { accessToken, accessTokenExpiresAt } = (await signup.json()) as {
    accessToken: string;
    accessTokenExpiresAt: string;
  };

  const site = await startArticleServer();
  const context = await launchWithExtension();
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });

  await worker.evaluate(
    async (session) => chrome.storage.local.set({ booklet_session: session }),
    { accessToken, accessTokenExpiresAt, email },
  );

  const page = await context.newPage();
  await page.goto(site.url);

  // Select the first sentence the way a reader would, then let the content
  // script's mouseup handler notice it.
  await page.evaluate((quote) => {
    const target = document.querySelector("#target")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(target, 0);
    range.setEnd(target, quote.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, HIGHLIGHT_TARGET);

  // Playwright's selectors pierce open shadow roots, which is where the
  // extension's own UI lives (page CSS can't be trusted not to eat it).
  await page.getByRole("button", { name: "Highlight" }).click();
  await expect(page.locator("mark.booklet-web-highlight")).toHaveCount(1);

  await expect(page.getByText("1 highlight", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open in Booklet" }).click();

  // The import clears local highlights only once the server confirms, so the
  // bar disappearing is itself the success signal.
  await expect(page.locator("mark.booklet-web-highlight")).toHaveCount(0, { timeout: 20_000 });

  const list = await fetch(`${API_URL}/api/articles?url=${encodeURIComponent(site.url)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { articles } = (await list.json()) as { articles: { id: string; title: string | null }[] };
  expect(articles).toHaveLength(1);

  const highlightsRes = await fetch(`${API_URL}/api/highlights?articleId=${articles[0].id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const highlights = (await highlightsRes.json()) as { selectedText: string; position: { type: string } }[];
  expect(highlights).toHaveLength(1);
  expect(highlights[0].selectedText).toBe(HIGHLIGHT_TARGET);
  expect(highlights[0].position.type).toBe("text");

  await context.close();
  await site.close();
});
