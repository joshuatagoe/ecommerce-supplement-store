// `npm run setup`: one command from a clean clone to a working local app.
import { copyFileSync, existsSync } from "node:fs";
import { runOrExit } from "./run.ts";

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}
process.loadEnvFile(".env");

runOrExit("npm ci");
runOrExit("docker compose up -d --wait");
for (const url of [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL]) {
  runOrExit("node scripts/migrate.ts", { ...process.env, DATABASE_URL: url });
}
runOrExit("npx playwright install chromium");

console.log("\nSetup done. Start the app with `npm run dev`, then open http://localhost:3000");
