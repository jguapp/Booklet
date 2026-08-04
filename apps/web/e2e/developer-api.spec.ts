import http from "node:http";
import { expect, test } from "@playwright/test";

/**
 * Personal access tokens (/api/v1) and webhooks -- both are authenticated-
 * account-only (see lib/data/developer.ts), so every test here signs up a
 * fresh real user through the UI first rather than using local/anonymous
 * mode like the rest of this suite.
 */

const API_URL = "http://localhost:4000";

async function signUp(page: import("@playwright/test").Page) {
  const email = `dev-api-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Dev API Test");
  await page.getByLabel("Email").fill(email);
  // exact: true -- a substring match of "Password" also catches the
  // password field's own "Show password" visibility toggle button.
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/library/, { timeout: 15_000 });
}

test("a generated token can create an article through /api/v1, and revoking it stops working", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings/developer");

  await page.getByPlaceholder(/token name/i).fill("E2E Test Token");
  await page.getByRole("button", { name: "Generate token" }).click();

  const tokenCode = page.getByTestId("generated-token");
  await expect(tokenCode).toBeVisible();
  const token = (await tokenCode.textContent())!.trim();
  expect(token).toMatch(/^blk_/);
  await page.getByRole("button", { name: "Done" }).click();

  const createRes = await fetch(`${API_URL}/api/v1/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: "https://en.wikipedia.org/wiki/Application_programming_interface" }),
  });
  expect(createRes.status).toBe(201);
  const created = await createRes.json();
  expect(created.sourceType).toBe("HTML");

  const listRes = await fetch(`${API_URL}/api/v1/articles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listRes.status).toBe(200);
  const list = await listRes.json();
  expect(list.articles.some((a: { id: string }) => a.id === created.id)).toBe(true);

  // Revoke via the UI, then confirm the same token is immediately rejected.
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("E2E Test Token")).toHaveCount(0);

  const afterRevoke = await fetch(`${API_URL}/api/v1/articles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(afterRevoke.status).toBe(401);
});

test("a read-only token can read but not write", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings/developer");

  await page.getByPlaceholder(/token name/i).fill("Read Only");
  await page.getByLabel("Allow write access").uncheck();
  await page.getByRole("button", { name: "Generate token" }).click();
  const token = (await page.getByTestId("generated-token").textContent())!.trim();
  await expect(page.getByText("Read only")).toBeVisible();

  const readRes = await fetch(`${API_URL}/api/v1/articles`, { headers: { Authorization: `Bearer ${token}` } });
  expect(readRes.status).toBe(200);

  const writeRes = await fetch(`${API_URL}/api/v1/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: "https://en.wikipedia.org/wiki/Scope_(computer_science)" }),
  });
  expect(writeRes.status).toBe(403);
});

test("a registered webhook receives a signed delivery when an article is created", async ({ page }) => {
  await signUp(page);

  // A tiny local receiver -- no external service/tunnel needed since the
  // API and this test both run on localhost.
  let receivedBody: string | null = null;
  let receivedSignature: string | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      receivedBody = Buffer.concat(chunks).toString("utf-8");
      receivedSignature = req.headers["x-booklet-signature"] as string;
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  await page.goto("/settings/developer");
  await page.getByPlaceholder(/your-endpoint/i).fill(`http://127.0.0.1:${port}/hook`);
  await page.getByLabel("Article saved").check();
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByText(`http://127.0.0.1:${port}/hook`)).toBeVisible();

  // Trigger article.created through the ordinary web UI (not the API) --
  // proves webhooks fire regardless of which path created the article.
  await page.goto("/library");
  await page.getByRole("button", { name: /save article/i }).click();
  await page.getByPlaceholder(/example\.com/).fill("https://en.wikipedia.org/wiki/Webhook");
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.getByRole("heading", { name: /save an article/i }).waitFor({ state: "hidden", timeout: 20_000 });

  await expect.poll(() => receivedBody, { timeout: 10_000 }).not.toBeNull();
  const payload = JSON.parse(receivedBody!);
  expect(payload.event).toBe("article.created");
  expect(receivedSignature).toMatch(/^[a-f0-9]{64}$/);

  await new Promise<void>((resolve) => server.close(() => resolve()));
});
