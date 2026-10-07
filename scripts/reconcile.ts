// `npm run reconcile`: checks every paid order adds up (ARCHITECTURE.md §7).
// Prints "Every paid order adds up", or each problem and exits with code 1.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sweepAfterMs } from "../src/server/config.ts";
import * as schema from "../src/server/db/schema.ts";
import { reconcile } from "../src/server/reporting/reconcile.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const db = drizzle(pool, { schema });
  const problems = await reconcile({ db, now: () => new Date(), sweepAfterMs: sweepAfterMs() });
  const { rows } = await pool.query("SELECT count(*)::int AS paid FROM orders WHERE status = 'paid'");
  if (problems.length === 0) {
    console.log(`Every paid order adds up (${rows[0].paid} paid orders checked).`);
  } else {
    console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
