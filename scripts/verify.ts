// `npm run verify`: the local checks before anything leaves the laptop
// (ARCHITECTURE.md §13). Stops at the first failure.
import { run } from "./run.ts";

const steps: [name: string, command: string][] = [
  ["Skill copies", "node scripts/check-skills.ts"],
  ["Typecheck", "npx next typegen && npx tsc --noEmit"],
  ["Lint", "npx eslint ."],
  ["Test database", "docker compose up -d --wait db-test"],
  ["Unit and integration tests", "npx vitest run"],
];

const results: string[] = [];
for (const [name, command] of steps) {
  const started = performance.now();
  const ok = run(command);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  results.push(`${ok ? "pass" : "FAIL"}  ${name} (${seconds}s)`);
  if (!ok) break;
}

console.log(`\nverify:\n  ${results.join("\n  ")}`);
if (results.some((line) => line.startsWith("FAIL")) || results.length < steps.length) process.exit(1);
