import { defineConfig } from "@playwright/test";

// The demo video (ARCHITECTURE.md §13): a slowed-down script drives the app in
// a visible browser while the user records and narrates. It runs against the
// dev server by default; set DEMO_URL to drive the live site instead. It
// changes data, like any real use, so rebuild the seed before a recording.
export default defineConfig({
  testDir: "tests/demo",
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: "list",
  use: {
    baseURL: process.env.DEMO_URL ?? "http://localhost:3000",
    headless: process.env.DEMO_HEADLESS === "1",
    viewport: { width: 1280, height: 800 },
    launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO ?? 400) },
  },
});
