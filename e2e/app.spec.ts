// The main journeys through the app in a real browser. The database starts as the sample data with one run
// (see e2e/seed.ts), so the expected results are the same as in the unit tests: SKU001 is the one exception.
import { expect, test, type Page } from "@playwright/test";
import { E2E_USERS, type E2eRole } from "./users";

async function signIn(page: Page, role: E2eRole, next = "/") {
  const u = E2E_USERS[role];
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByPlaceholder("Username").fill(u.username);
  await page.getByPlaceholder("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `side scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test.describe("signing in", () => {
  test("sends signed-out visitors to the login page and refuses a wrong password", async ({ page }) => {
    await page.goto("/review");
    await expect(page).toHaveURL(/\/login\?next=%2Freview/);
    await page.getByPlaceholder("Username").fill(E2E_USERS.viewer.username);
    await page.getByPlaceholder("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".status-error")).toHaveText("Wrong username or password.");
  });

  test("the cron job refuses calls without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/daily")).status()).toBe(401);
    expect((await request.get("/api/cron/daily", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });
});

test.describe("planner", () => {
  test("sees the plan, approves a recommendation, recalculates and compares the two runs", async ({ page }) => {
    await signIn(page, "planner");
    await expect(page.getByRole("heading", { name: "Weekly demand plan" })).toBeVisible();
    await expect(page.getByText("SKU001").first()).toBeVisible();

    // Approve the first pending recommendation on the Review page.
    await page.goto("/review");
    const pendingBefore = await page.locator(".review-item").count();
    expect(pendingBefore).toBe(7); // 1 exception + 4 stockouts + 2 overstocks
    await page.locator(".review-item").first().getByRole("button", { name: /^Approve/ }).click();
    await expect(page.locator(".review-item")).toHaveCount(pendingBefore - 1);
    await expect(page.getByRole("heading", { name: /^Decided \(1\)/ })).toBeVisible();

    // A new run, then the history page compares it with the seeded one.
    await page.goto("/");
    await page.getByRole("button", { name: "Recalculate" }).click();
    await expect(page.getByRole("button", { name: "Recalculate" })).toBeEnabled({ timeout: 30_000 });
    await page.goto("/runs");
    await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
    const comparison = page.getByTestId("comparison");
    await expect(comparison.getByRole("heading", { name: /Run #1 .*→ Run #2/ })).toBeVisible();
    // Same data and thresholds, so nothing changed.
    await expect(comparison.getByText("No recommendation changed across 15 SKUs.")).toBeVisible();
    await expect(comparison.getByText("Same thresholds in both runs")).toBeVisible();
    await expect(page.getByRole("link", { name: "Compare with #1" })).toBeVisible();
  });

  test("has no side scroll on the main pages at phone and desktop widths", async ({ page }) => {
    await signIn(page, "planner");
    for (const size of [
      { width: 320, height: 800 },
      { width: 375, height: 812 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      for (const path of ["/", "/review", "/approved", "/performance", "/runs", "/upload", "/settings", "/sku/SKU001"]) {
        await page.goto(path);
        await noSideScroll(page);
      }
    }
  });
});

test.describe("procurement", () => {
  test("sees approved orders and run history but can't upload or change settings", async ({ page }) => {
    await signIn(page, "procurement");
    await page.goto("/approved");
    await expect(page.getByRole("heading", { name: "Approved orders" })).toBeVisible();
    await page.goto("/runs");
    await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
    for (const path of ["/upload", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/\?denied=1$/);
    }
    await expect(page.getByRole("link", { name: "Upload data" })).toHaveCount(0);
  });
});

test.describe("viewer", () => {
  test("only gets the dashboard and Performance", async ({ page }) => {
    await signIn(page, "viewer");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Performance"]);
    await page.goto("/performance");
    await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
    for (const path of ["/review", "/runs", "/approved", "/sku/SKU001"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/\?denied=1$/);
    }
  });
});
