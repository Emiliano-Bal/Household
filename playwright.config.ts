import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real app against a real, migrated Postgres
// (DATABASE_URL) — same standard as the *.db.test.ts suites. Kept out of
// `npm test`, which stays DB-free and always green; run with `npm run e2e`.
//
// The server is the production build rather than `next dev`, so what the
// tests exercise is what gets deployed.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  // These tests seed and tear down their own household; running files in
  // parallel against one database invites cross-talk for no real gain at
  // this suite size.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "" },
  },
});
