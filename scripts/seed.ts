// `npm run seed`: builds the demo data. `--if-empty` (Render's start command)
// seeds only a database with no catalog; `--reset` empties every table and
// rebuilds. With neither, it behaves like --if-empty.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { appUrl, feeRateBps, linkSigningKey, linkTtlDays } from "../src/server/config.ts";
import * as schema from "../src/server/db/schema.ts";
import { seedDemo } from "../src/server/seed/index.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const mode = process.argv.includes("--reset") ? "reset" : "if-empty";
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const result = await seedDemo(drizzle(pool, { schema }), mode, {
    feeRateBps: feeRateBps(),
    linkSigningKey: linkSigningKey(),
    appUrl: appUrl(),
    linkTtlDays: linkTtlDays(),
  });
  console.log(result === "seeded" ? "Seeded the demo data." : "The database is already seeded; left it alone.");
} finally {
  await pool.end();
}
