import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Test workers inherit these, so integration tests can read TEST_DATABASE_URL.
// A fresh git worktree has no .env, so it falls back to the committed local
// defaults (D45). CI sets the variables itself.
for (const file of [".env", ".env.example"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // Try the next file.
  }
}

// Status-change logs (pino) would bury test output.
process.env.LOG_LEVEL ??= "silent";

// A linked git worktree (where `.git` is a file) gets its own test database on
// the shared test server, so parallel agents never migrate or write the same
// one (D45). The main checkout and CI keep the database named in the URL.
if (process.env.TEST_DATABASE_URL && statSync(".git", { throwIfNoEntry: false })?.isFile()) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  const checkout = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 10);
  url.pathname = `${url.pathname}_wt_${checkout}`;
  process.env.TEST_DATABASE_URL = url.href;
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "golden", include: ["tests/golden/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
        },
      },
    ],
  },
});
