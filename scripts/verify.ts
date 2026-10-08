// `npm run verify`: the local checks before anything leaves the laptop
// (ARCHITECTURE.md §13). Stops at the first failure.
import { run } from "./run.ts";

for (const file of [".env", ".env.example"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // Try the next file.
  }
}
// Reconciliation runs on a fresh seed in the test database, never the app's own.
const testDatabase = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };

const steps: [name: string, command: string, env?: NodeJS.ProcessEnv][] = [
  ["Skill copies", "node scripts/check-skills.ts"],
  ["Typecheck", "npx next typegen && npx tsc --noEmit"],
  ["Lint", "npx eslint ."],
  ["Test database", "docker compose up -d --wait db-test"],
  // The JSON report gives the README check the run's own test count.
  ["Unit and integration tests", "npx vitest run --reporter=default --reporter=json --outputFile=tests/.results/vitest.json"],
  ["Reconcile a fresh seed", "node scripts/seed.ts --reset && node scripts/reconcile.ts", testDatabase],
  ["README numbers", "node scripts/check-readme.ts"],
];

const results: string[] = [];
for (const [name, command, env] of steps) {
  const started = performance.now();
  const ok = run(command, env);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  results.push(`${ok ? "pass" : "FAIL"}  ${name} (${seconds}s)`);
  if (!ok) break;
}

console.log(`\nverify:\n  ${results.join("\n  ")}`);
if (results.some((line) => line.startsWith("FAIL")) || results.length < steps.length) process.exit(1);
