import { defineConfig, devices } from "@playwright/test";

// Locally this reuses the one shared dev server (frontend-engineer); CI starts
// the production build instead.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One worker: the specs share the seeded database, and one spec's edits
  // (Dr. Rivera's prices, Dr. Patel's store) would race another's checks.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3000" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000/robots.txt",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
