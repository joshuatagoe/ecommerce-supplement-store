import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Test workers inherit these, so integration tests can read TEST_DATABASE_URL.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env (CI sets the variables itself).
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
