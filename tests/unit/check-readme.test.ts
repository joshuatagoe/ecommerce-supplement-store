// The README's test counts must match a fresh run (ARCHITECTURE.md §13): a
// stale number in the README fails `verify` and CI.
import { describe, expect, it } from "vitest";
import { readmeProblems } from "../../scripts/check-readme";

const README = `
- **338 unit, integration and property tests** (Vitest)
- **52 browser tests** (Playwright)
`;

describe("readmeProblems", () => {
  it("passes when the README's counts match the run", () => {
    expect(readmeProblems(README, { vitest: 338, playwright: 52 })).toEqual([]);
  });

  it("names each count that has gone stale", () => {
    expect(readmeProblems(README, { vitest: 340, playwright: 50 })).toEqual([
      "README says 338 unit, integration and property tests; a fresh run has 340.",
      "README says 52 browser tests; a fresh run has 50.",
    ]);
  });

  it("fails when the README no longer states a count", () => {
    expect(readmeProblems("# No numbers here", { vitest: 338, playwright: 52 })).toEqual([
      'README has no "N unit, integration and property tests" line.',
      'README has no "N browser tests" line.',
    ]);
  });

  it("reads numbers written with a thousands comma", () => {
    expect(readmeProblems("**1,204 unit, integration and property tests** and **52 browser tests**", { vitest: 1204, playwright: 52 })).toEqual([]);
  });
});
