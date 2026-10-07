// `npm run smoke` (ARCHITECTURE.md §13, M7): after a deploy, against the live
// URL, it waits for the expected build, then checks health, the portal sign-in,
// and that a seeded pay link loads. It only reads: it never sends or pays.
// Here it runs against the local server, where health reports no commit.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function smoke(...args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["scripts/smoke.ts", ...args], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { code: failed.status, output: `${failed.stdout}${failed.stderr}` };
  }
}

test("passes against a healthy site: health, sign-in, and a seeded pay link", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const run = smoke("--url", baseURL!, "--any-commit", "--wait", "30");
  expect(run.output).toContain("health ok");
  expect(run.output).toContain("sign-in ok");
  expect(run.output).toContain("pay link ok");
  expect(run).toMatchObject({ code: 0, output: expect.stringContaining("Smoke passed") });
});

test("fails when the expected build never shows up", async ({ baseURL }) => {
  test.setTimeout(60_000);
  const run = smoke("--url", baseURL!, "--commit", "0000000", "--wait", "3");
  expect(run.code).toBe(1);
  expect(run.output).toContain("expected commit 0000000");
});

test("fails when the site can't be reached", async () => {
  test.setTimeout(60_000);
  const run = smoke("--url", "http://127.0.0.1:1", "--any-commit", "--wait", "3");
  expect(run.code).toBe(1);
  expect(run.output).toContain("health never passed");
});
