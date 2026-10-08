// The README number check (ARCHITECTURE.md §13): the test counts the README
// states must match a fresh run. `npm run verify` runs it after the tests, so
// a stale number fails locally and in CI.
//
// Vitest's count comes from the JSON report the verify run just wrote, since
// `vitest list` doesn't expand it.each cases. Playwright's comes from
// `playwright test --list`, which counts without starting a server.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VITEST_REPORT = "tests/.results/vitest.json";

const COUNTS = [
  { key: "vitest", label: "unit, integration and property tests" },
  { key: "playwright", label: "browser tests" },
] as const;

export function readmeProblems(readme: string, counts: { vitest: number; playwright: number }): string[] {
  const problems: string[] = [];
  for (const { key, label } of COUNTS) {
    const match = new RegExp(`(\\d[\\d,]*) ${label}`).exec(readme);
    if (!match) {
      problems.push(`README has no "N ${label}" line.`);
      continue;
    }
    const stated = Number(match[1].replaceAll(",", ""));
    if (stated !== counts[key]) problems.push(`README says ${match[1]} ${label}; a fresh run has ${counts[key]}.`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vitest = (JSON.parse(readFileSync(VITEST_REPORT, "utf8")) as { numTotalTests: number }).numTotalTests;
  const listed = execSync("npx playwright test --list", { encoding: "utf8" });
  const total = /Total: (\d+) tests? in/.exec(listed);
  if (!total) {
    console.error("Couldn't count the browser tests from `playwright test --list`.");
    process.exit(1);
  }
  const problems = readmeProblems(readFileSync("README.md", "utf8"), { vitest, playwright: Number(total[1]) });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`README numbers match: ${vitest} Vitest tests, ${total[1]} browser tests.`);
}
