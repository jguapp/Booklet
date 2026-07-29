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
