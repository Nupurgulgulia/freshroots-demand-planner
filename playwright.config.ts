// End-to-end tests: a real browser against the real app, on its own throwaway database.
// `npm run e2e` seeds ./.pglite-e2e from the sample CSVs, starts the app on port 3100 (build output in
// .next-e2e, so it can run next to `npm run dev`), and runs e2e/*.spec.ts.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // One local database file, one server: run tests one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx e2e/seed.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PGLITE_DIR: ".pglite-e2e",
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_SECRET: "e2e-only-auth-secret-not-used-anywhere-else",
      CRON_SECRET: "e2e-only-cron-secret",
      // Values set here win over .env.local, so nothing leaves the machine during the tests:
      // no live database, no Gemini, no Zoho, no emails.
      DATABASE_URL: "",
      GEMINI_API_KEY: "",
      RESEND_API_KEY: "",
      ZOHO_CLIENT_ID: "",
      ZOHO_ORDERING_ENABLED: "",
      ZOHO_API_BASE: "",
      ZOHO_ACCOUNTS_BASE: "",
      LOGIN_HINT: "",
    },
  },
});
