import { expect, test, type Page } from "@playwright/test";

/**
 * The show/hide password toggle, and the Booklet mark that shuts its eyes
 * while the password is on screen.
 *
 * The mark is deliberately aria-hidden (the toggle already announces the
 * state properly), so these assert on the SVG's own eye shapes rather than
 * on anything accessible -- that's the only way to catch the character
 * silently breaking, which is the whole point of it being there.
 *
 * Asserted via opacity rather than toBeVisible/toBeHidden: the two eye states
 * are cross-faded, so both are always laid out and Playwright counts an
 * opacity-0 element as visible.
 */

const OPEN_EYES = "[data-testid='peek-eyes-open']";
const SHUT_EYES = "[data-testid='peek-eyes-shut']";

async function expectEyes(page: Page, state: "open" | "shut") {
  await expect(page.locator(OPEN_EYES)).toHaveCSS("opacity", state === "open" ? "1" : "0");
  await expect(page.locator(SHUT_EYES)).toHaveCSS("opacity", state === "shut" ? "1" : "0");
}

/**
 * Click "Show password", retrying until it takes.
 *
 * The button paints with the server-rendered HTML but does nothing until
 * React hydrates, so a single click can land on a live-looking button that
 * has no handler yet. Retrying is safe rather than double-toggling because
 * the accessible name flips to "Hide password" the instant it works -- so
 * this locator stops matching and the loop can't click it back off.
 */
async function revealPassword(page: Page) {
  const showToggle = page.getByRole("button", { name: "Show password" });
  await expect(async () => {
    if (await showToggle.isVisible()) await showToggle.click();
    await expect(page.locator("input[name='password']")).toHaveAttribute("type", "text", { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test("toggling password visibility reveals the text and shuts the mark's eyes", async ({ page }) => {
  await page.goto("/login");

  const password = page.locator("input[name='password']");
  await password.fill("hunter2-secret");

  await expect(password).toHaveAttribute("type", "password");
  await expectEyes(page, "open");

  await revealPassword(page);

  await expect(password).toHaveValue("hunter2-secret");
  await expectEyes(page, "shut");

  await page.getByRole("button", { name: "Hide password" }).click();

  await expect(password).toHaveAttribute("type", "password");
  await expectEyes(page, "open");
});

test("the toggle doesn't submit the form it sits inside", async ({ page }) => {
  await page.goto("/login");
  await page.locator("input[name='email']").fill("nobody@example.com");
  await page.locator("input[name='password']").fill("hunter2-secret");

  await revealPassword(page);
  await page.waitForTimeout(500);

  // A button inside a <form> defaults to type="submit" -- getting that wrong
  // would fire a real login attempt every time someone peeked at their own
  // password.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
});

test("signup and reset-password get the same treatment", async ({ page }) => {
  for (const path of ["/signup", "/reset-password?token=dummy"]) {
    await page.goto(path);
    // Wait on the toggle rather than racing hydration -- under a dev server
    // these routes compile on first hit, and the eye assertions below are
    // only meaningful once the form is actually interactive.
    await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
    await expectEyes(page, "open");

    await revealPassword(page);
    await expectEyes(page, "shut");
  }
});
