// The PRD's impact metrics (PROBLEM_SPACE.md "Metrics"), read only, by UTC
// month (D29): GMV and the 75 bps we earn on it, moved volume per provider
// with each one's first order, provider engagement, and how long orders take
// to be sent and paid. `npm run metrics` prints them; there's no platform
// dashboard in the slice.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";

export type MonthMetrics = {
  /** UTC month, e.g. "2026-10". */
  month: string;
  paidOrders: number;
  gmvCents: number;
  feeCents: number;
  /** Providers who sent at least one order that month. */
  activeProviders: number;
  /** Orders sent that month that came from Order again. */
  repeatOrders: number;
  /** For orders sent that month: start of the draft to Send. */
  medianMinutesToSend: number | null;
  /** For orders paid that month: Send to payment. */
  medianMinutesToPay: number | null;
  /** Moved volume: each provider's GMV that month, with the date they first sent an order. */
  providers: { providerId: string; providerName: string; gmvCents: number; firstOrderAt: Date }[];
};

const month = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM')`);

export async function platformMetrics(db: Db): Promise<MonthMetrics[]> {
  const paid = await db.execute(sql`
    SELECT ${month("paid_at")} AS month, count(*)::int AS orders,
           sum(total_cents)::text AS gmv, sum(fee_cents)::text AS fee,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM paid_at - sent_at) / 60) AS to_pay
      FROM orders WHERE status = 'paid' GROUP BY 1`);
  const sent = await db.execute(sql`
    SELECT ${month("sent_at")} AS month, count(DISTINCT provider_id)::int AS providers,
           count(*) FILTER (WHERE source_order_id IS NOT NULL)::int AS repeats,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - created_at) / 60) AS to_send
      FROM orders WHERE sent_at IS NOT NULL GROUP BY 1`);
  const byProvider = await db.execute(sql`
    SELECT ${month("o.paid_at")} AS month, o.provider_id, pr.display_name, sum(o.total_cents)::text AS gmv,
           (SELECT min(f.sent_at) FROM orders f WHERE f.provider_id = o.provider_id) AS first_order_at
      FROM orders o JOIN providers pr ON pr.id = o.provider_id
     WHERE o.status = 'paid' GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`);

  const months = new Map<string, MonthMetrics>();
  const at = (key: string) => {
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        paidOrders: 0,
        gmvCents: 0,
        feeCents: 0,
        activeProviders: 0,
        repeatOrders: 0,
        medianMinutesToSend: null,
        medianMinutesToPay: null,
        providers: [],
      });
    }
    return months.get(key)!;
  };
  const minutes = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)));
  for (const row of paid.rows) {
    Object.assign(at(row.month as string), {
      paidOrders: Number(row.orders),
      gmvCents: Number(row.gmv),
      feeCents: Number(row.fee),
      medianMinutesToPay: minutes(row.to_pay),
    });
  }
  for (const row of sent.rows) {
    Object.assign(at(row.month as string), {
      activeProviders: Number(row.providers),
      repeatOrders: Number(row.repeats),
      medianMinutesToSend: minutes(row.to_send),
    });
  }
  for (const row of byProvider.rows) {
    at(row.month as string).providers.push({
      providerId: row.provider_id as string,
      providerName: row.display_name as string,
      gmvCents: Number(row.gmv),
      firstOrderAt: new Date(row.first_order_at as string),
    });
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
