// The reconciliation check (ARCHITECTURE.md §7): what the database rules can't
// express. Each paid order's totals equal the sum of its lines; each paid
// order has exactly one succeeded attempt, for its total; no unpaid order has
// a succeeded attempt; and no attempt has been pending longer than the sweep
// allows. Runs as `npm run reconcile`, in `verify` on a fresh seed, and after
// every load test.
import { sql } from "drizzle-orm";
import { formatCents } from "../../shared/money.ts";
import type { Db } from "../db/client.ts";

/** The sweep gets a minute past SWEEP_AFTER_MS to settle an attempt before it counts as a problem. */
const SWEEP_GRACE_MS = 60_000;

export async function reconcile(ctx: { db: Db; now: () => Date; sweepAfterMs: number }): Promise<string[]> {
  const problems: string[] = [];

  const totals = await ctx.db.execute(sql`
    SELECT o.ref, o.total_cents, o.cost_cents, o.fee_cents, o.margin_cents,
           sum(l.unit_price_cents * l.quantity)::text AS line_total,
           sum(l.unit_cost_cents * l.quantity)::text AS line_cost,
           sum(l.unit_fee_cents * l.quantity)::text AS line_fee,
           sum(l.unit_margin_cents * l.quantity)::text AS line_margin
      FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
     WHERE o.status = 'paid'
     GROUP BY o.id`);
  for (const row of totals.rows) {
    const mismatch =
      Number(row.total_cents) !== Number(row.line_total) ||
      Number(row.cost_cents) !== Number(row.line_cost) ||
      Number(row.fee_cents) !== Number(row.line_fee) ||
      Number(row.margin_cents) !== Number(row.line_margin);
    if (mismatch) {
      problems.push(
        `${row.ref}: the order's totals (${formatCents(Number(row.total_cents))}) don't match its lines (${formatCents(Number(row.line_total ?? 0))})`,
      );
    }
  }

  const payments = await ctx.db.execute(sql`
    SELECT o.ref, o.total_cents, count(a.id)::int AS succeeded, min(a.amount_cents) AS amount, max(a.amount_cents) AS max_amount
      FROM orders o LEFT JOIN payment_attempts a ON a.order_id = o.id AND a.status = 'succeeded'
     WHERE o.status = 'paid'
     GROUP BY o.id`);
  for (const row of payments.rows) {
    if (Number(row.succeeded) !== 1) {
      problems.push(`${row.ref}: it has ${row.succeeded} succeeded payments, not 1`);
    } else if (Number(row.amount) !== Number(row.total_cents)) {
      problems.push(
        `${row.ref}: the payment was for ${formatCents(Number(row.amount))}, not the order's ${formatCents(Number(row.total_cents))}`,
      );
    }
  }

  const unpaid = await ctx.db.execute(sql`
    SELECT DISTINCT o.ref FROM orders o JOIN payment_attempts a ON a.order_id = o.id
     WHERE a.status = 'succeeded' AND o.status <> 'paid'`);
  for (const row of unpaid.rows) problems.push(`${row.ref}: a payment succeeded, but the order isn't paid`);

  const cutoff = new Date(ctx.now().getTime() - ctx.sweepAfterMs - SWEEP_GRACE_MS);
  const stuck = await ctx.db.execute(sql`
    SELECT o.ref, a.created_at FROM payment_attempts a JOIN orders o ON o.id = a.order_id
     WHERE a.status = 'pending' AND a.created_at < ${cutoff}
     ORDER BY a.created_at`);
  for (const row of stuck.rows) {
    const minutes = Math.floor((ctx.now().getTime() - new Date(row.created_at as string).getTime()) / 60_000);
    problems.push(`${row.ref}: a payment has been pending for ${minutes} minutes, longer than the sweep allows`);
  }

  return problems;
}
