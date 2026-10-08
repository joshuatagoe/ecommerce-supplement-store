// `npm run load:l1` (and l2, l3, race) and `npm run drill:outage`: the load
// tests of ARCHITECTURE.md §2, run with k6 on this laptop (D18).
//
// Each run gets a fresh local database, `store_load`, so the shared dev
// server and its sweep never touch load data. It seeds that database, starts
// the production build (`npm run build` first) on port 3100 against it,
// writes the context k6 needs (the build's action IDs, a signed session per
// provider, their patients and store prices), runs k6, lets the sweep settle,
// then checks the money: reconciliation, one charge per order, and every
// charge the payment company took recorded as a payment.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { signSession } from "../src/server/access/session.ts";
import { runMigrations } from "./migrate.ts";

const LEVELS: Record<string, { rate: number; duration: string; vus: number }> = {
  l1: { rate: 3, duration: "10m", vus: 60 },
  l2: { rate: 30, duration: "3m", vus: 600 },
  l3: { rate: 800, duration: "1m", vus: 1000 },
};

const mode = process.argv[2] ?? "l1";
if (!(mode in LEVELS) && mode !== "race" && mode !== "drill") {
  console.error("Usage: node scripts/load.ts l1|l2|l3|race|drill");
  process.exit(1);
}

process.loadEnvFile(".env");
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const RUN = "tests/load/.run";
const STUB = ".data/load-stub.json";
const server = new URL(process.env.DATABASE_URL!);
const loadUrl = new URL(server.href);
loadUrl.pathname = "/store_load";
mkdirSync(RUN, { recursive: true });

if (!existsSync(".next/server/server-reference-manifest.json")) {
  console.error("Build first: npm run build");
  process.exit(1);
}

// A fresh database and a fresh payment-company file for every run.
const admin = new pg.Client({ connectionString: server.href });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS store_load WITH (FORCE)");
await admin.query("CREATE DATABASE store_load");
await admin.end();
await runMigrations(loadUrl.href);
writeFileSync(STUB, JSON.stringify({ charges: {} }));
const env = { ...process.env, DATABASE_URL: loadUrl.href, STUB_STORE_PATH: STUB, APP_URL: BASE, LOG_LEVEL: "warn", PORT: String(PORT) };
execFileSync(process.execPath, ["scripts/seed.ts", "--reset"], { env, stdio: "inherit" });

const app: ChildProcess = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "start", "-p", String(PORT)], {
  env,
  stdio: ["ignore", "ignore", "inherit"],
  shell: process.platform === "win32",
});
const stop = () => {
  if (process.platform === "win32" && app.pid) execFileSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  else app.kill();
};

try {
  for (let i = 0; ; i++) {
    const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i > 120) throw new Error("The load server never became healthy");
    await sleep(500);
  }

  // What k6 needs: action IDs by name, a session per provider, patients and store prices.
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node as Record<
    string,
    { exportedName: string }
  >;
  const actions = Object.fromEntries(Object.entries(manifest).map(([id, entry]) => [entry.exportedName, id]));
  const db = new pg.Client({ connectionString: loadUrl.href });
  await db.connect();
  const providers = [];
  for (const provider of (await db.query("SELECT id, practice_id, display_name FROM providers ORDER BY display_name")).rows) {
    const patients = await db.query("SELECT id FROM patients WHERE practice_id = $1", [provider.practice_id]);
    const store = await db.query("SELECT catalog_item_id, usual_price_cents FROM store_items WHERE provider_id = $1", [provider.id]);
    providers.push({
      name: provider.display_name,
      cookie: `session=${await signSession(provider.id, process.env.JWT_SECRET!)}`,
      patientIds: patients.rows.map((row) => row.id),
      lines: store.rows.map((row) => ({ catalogItemId: row.catalog_item_id, priceCents: row.usual_price_cents })),
    });
  }
  await db.end();
  writeFileSync(`${RUN}/context.json`, JSON.stringify({ base: BASE, actions, providers }, null, 2));

  // Run k6. The drill stops the database partway through a Level 1 run.
  const level = mode === "drill" ? { rate: 3, duration: "4m", vus: 120 } : LEVELS[mode];
  const script = mode === "race" ? "tests/load/race.js" : "tests/load/orders.js";
  const k6Env = level ? ["-e", `RATE=${level.rate}`, "-e", `DURATION=${level.duration}`, "-e", `VUS=${level.vus}`] : [];
  const summary = `${RUN}/${mode}-summary.json`;
  const k6 = spawn("k6", ["run", "--quiet", "-e", `MODE=${mode}`, ...k6Env, "--summary-export", summary, script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (mode === "drill") {
    // 60 s of normal traffic, then 30 s with the database down, then recovery.
    await sleep(60_000);
    console.log("\n[drill] stopping the database");
    execFileSync("docker", ["compose", "stop", "db"], { stdio: "inherit" });
    await sleep(30_000);
    console.log("[drill] starting the database again");
    execFileSync("docker", ["compose", "start", "db"], { stdio: "inherit" });
  }
  const k6Code: number = await new Promise((resolve) => k6.on("exit", (code) => resolve(code ?? 1)));

  // Let the sweep settle anything left pending (SWEEP_AFTER_MS plus a few runs).
  await sleep(25_000);
  const checks = await moneyChecks();
  writeFileSync(`${RUN}/${mode}-checks.json`, JSON.stringify(checks, null, 2));
  console.log(`\n[${mode}] money checks:`, JSON.stringify(checks, null, 2));
  const raceOk =
    !checks.race ||
    (checks.race.paymentsSucceeded === 1 && checks.race.chargesForTheOrder === 1 && checks.race.sendsRecorded === 1 && checks.race.linksSent === 1);
  const moneyOk = checks.problems.length === 0 && checks.doubleCharges === 0 && checks.chargesWithoutPayment === 0 && raceOk;
  process.exitCode = k6Code === 0 && moneyOk ? 0 : 1;
} finally {
  stop();
}

/**
 * The money after the run: reconciliation, orders with more than one charge,
 * and charges the payment company took that our database doesn't show as a
 * succeeded payment (a paid order lost).
 */
async function moneyChecks() {
  const reconcile = (() => {
    try {
      return execFileSync(process.execPath, ["scripts/reconcile.ts"], { env, encoding: "utf8" });
    } catch (error) {
      return (error as { stdout: string }).stdout;
    }
  })();
  const charges = JSON.parse(readFileSync(STUB, "utf8")).charges as Record<string, { status: string }>;
  const charged = Object.entries(charges)
    .filter(([, charge]) => charge.status === "charged")
    .map(([attemptId]) => attemptId);
  const db = new pg.Client({ connectionString: loadUrl.href });
  await db.connect();
  const succeeded = new Set(
    (await db.query("SELECT id FROM payment_attempts WHERE status = 'succeeded'")).rows.map((row) => row.id as string),
  );
  const perOrder = await db.query(
    "SELECT order_id, count(*)::int AS n FROM payment_attempts WHERE id = ANY($1::uuid[]) GROUP BY order_id HAVING count(*) > 1",
    [charged],
  );
  // The race (§2): exactly one charge for the order paid 50 times at once, and one link for the draft sent 20 times.
  let race: Record<string, number> | undefined;
  if (mode === "race") {
    const { payRef, sendRef } = JSON.parse(readFileSync(`${RUN}/race-refs.json`, "utf8"));
    const attempts = (await db.query(
      "SELECT a.id, a.status FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.ref = $1",
      [payRef],
    )).rows;
    const events = (await db.query(
      "SELECT e.kind, count(*)::int AS n FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.ref = $1 GROUP BY e.kind",
      [sendRef],
    )).rows;
    const kinds = Object.fromEntries(events.map((row) => [row.kind, row.n]));
    race = {
      attemptsSaved: attempts.length,
      paymentsSucceeded: attempts.filter((row) => row.status === "succeeded").length,
      chargesForTheOrder: attempts.filter((row) => charged.includes(row.id)).length,
      sendsRecorded: kinds.sent ?? 0,
      linksSent: kinds.link_sent ?? 0,
    };
  }
  const counts = (await db.query("SELECT status, count(*)::int AS n FROM orders GROUP BY status ORDER BY status")).rows;
  const pending = (await db.query("SELECT count(*)::int AS n FROM payment_attempts WHERE status = 'pending'")).rows[0].n;
  await db.end();
  return {
    reconcile: reconcile.trim().split("\n")[0],
    problems: reconcile.includes("Every paid order adds up") ? [] : reconcile.trim().split("\n").slice(1),
    charges: charged.length,
    doubleCharges: perOrder.rowCount,
    chargesWithoutPayment: charged.filter((id) => !succeeded.has(id)).length,
    pendingAttempts: pending,
    orders: Object.fromEntries(counts.map((row) => [row.status, row.n])),
    ...(race ? { race } : {}),
  };
}
