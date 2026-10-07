// `npm run smoke` (ARCHITECTURE.md §13, D36): after a deploy, checks the live
// site from outside. It waits for Render Free to wake and for the new build to
// answer, then checks health, that the portal sign-in works, and that a seeded
// pay link loads. It only reads: it signs in, but never sends or pays, and it
// copies the pay link through the portal, so no signing key is needed here.
//
//   npm run smoke -- [--url URL] [--commit SHA | --any-commit] [--wait SECONDS]
//
// The URL defaults to SMOKE_URL or the live demo; the commit defaults to this
// checkout's HEAD; the wait defaults to 120 seconds.
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const LIVE = "https://ecommerce-supplement-store-qywu.onrender.com";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const base = (option("url") ?? process.env.SMOKE_URL ?? LIVE).replace(/\/+$/, "");
const anyCommit = process.argv.includes("--any-commit");
const commit = anyCommit
  ? null
  : (option("commit") ?? execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim());
const waitMs = Number(option("wait") ?? 120) * 1000;

function fail(message: string): never {
  console.error(`Smoke failed: ${message}`);
  process.exit(1);
}

// 1. Health, waiting for the site to wake and for the expected build.
let last = "no answer";
const deadline = Date.now() + waitMs;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(20_000) });
    const body = (await response.json()) as { ok?: boolean; commit?: string | null; milestone?: string };
    last = `HTTP ${response.status} ${JSON.stringify(body)}`;
    if (response.ok && body.ok && (commit === null || body.commit === commit)) {
      console.log(`health ok: milestone ${body.milestone}, commit ${body.commit ?? "(none locally)"}`);
      healthy = true;
      break;
    }
  } catch (error) {
    last = (error as Error).message;
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!healthy) {
  fail(`health never passed within ${waitMs / 1000} s${commit ? ` (expected commit ${commit})` : ""}. Last: ${last}`);
}

const browser = await chromium.launch();
try {
  // 2. The portal sign-in works and opens Sales.
  const portal = await browser.newPage();
  await portal.goto(`${base}/sign-in`);
  await portal.getByRole("button", { name: /^Sign in as / }).first().click();
  await portal.waitForURL(/\/sales$/, { timeout: 30_000 }).catch(() => fail(`sign-in didn't open Sales (at ${portal.url()})`));
  console.log("sign-in ok");

  // 3. A seeded pay link loads for a patient with no session.
  await portal.goto(`${base}/sales?status=sent`);
  const order = portal.getByRole("rowheader").getByRole("link").first();
  if ((await order.count()) === 0) fail("no sent order in Sales to take a pay link from");
  await order.click();
  const link = await portal.getByLabel("Pay link").inputValue({ timeout: 30_000 });
  const patient = await browser.newContext();
  const pay = await patient.newPage();
  const response = await pay.goto(link);
  if (response?.status() !== 200) fail(`the pay link answered HTTP ${response?.status()}`);
  await pay.getByRole("heading", { name: /^Recommended by / }).waitFor({ timeout: 30_000 });
  await pay.getByRole("button", { name: /^Pay \$/ }).waitFor();
  console.log("pay link ok");
} catch (error) {
  fail((error as Error).message.split("\n")[0]);
} finally {
  await browser.close();
}

console.log(`Smoke passed against ${base}`);
