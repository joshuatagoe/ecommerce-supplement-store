// `npm run metrics`: the PRD's numbers by UTC month, read only (M5 grill).
// GMV and the 75 bps fee, paid orders, active providers, repeat orders, how
// long orders take to send and to pay, and moved volume per provider.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { formatCents } from "../src/shared/money.ts";
import * as schema from "../src/server/db/schema.ts";
import { platformMetrics } from "../src/server/reporting/metrics.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const minutes = (value: number | null) => (value === null ? "—" : value < 120 ? `${value} min` : `${(value / 60).toFixed(1)} h`);

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const months = await platformMetrics(drizzle(pool, { schema }));
  if (months.length === 0) {
    console.log("No orders yet.");
  } else {
    console.table(
      months.map((m) => ({
        "Month (UTC)": m.month,
        "Paid orders": m.paidOrders,
        GMV: formatCents(m.gmvCents),
        "Fees (75 bps)": formatCents(m.feeCents),
        "Active providers": m.activeProviders,
        "Repeat orders": m.repeatOrders,
        "Median time to send": minutes(m.medianMinutesToSend),
        "Median time to pay": minutes(m.medianMinutesToPay),
      })),
    );
    console.log("\nMoved volume (GMV per provider per month):");
    console.table(
      months.flatMap((m) =>
        m.providers.map((p) => ({
          "Month (UTC)": m.month,
          Provider: p.providerName,
          GMV: formatCents(p.gmvCents),
          "First order sent": p.firstOrderAt.toISOString().slice(0, 10),
        })),
      ),
    );
  }
} finally {
  await pool.end();
}
