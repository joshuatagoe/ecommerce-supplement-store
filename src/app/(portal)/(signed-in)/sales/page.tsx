import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { monthTotals, searchOrders } from "@/server/reporting";
import { formatCents } from "@/shared/money";
import { searchOrdersInput } from "@/shared/schemas";
import { requireProvider } from "../../session";
import { withLinks } from "./links";
import { SalesList } from "./SalesList";
import styles from "./sales.module.css";

export const metadata: Metadata = { title: "Sales" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** F4: this month's totals, then every order with its status and action. Filters live in the URL; search text doesn't. */
export default async function SalesPage({ searchParams }: Props) {
  const provider = await requireProvider();
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  // A filter that doesn't parse is dropped rather than failing the page.
  const parsed = searchOrdersInput.safeParse({
    status: pick("status"),
    dateField: pick("dateField"),
    from: pick("from"),
    to: pick("to"),
  });
  const filters = parsed.success ? parsed.data : { dateField: "created" as const };
  const ctx = { db, now: () => new Date() };
  const [month, first] = await Promise.all([monthTotals(ctx, provider), searchOrders(ctx, provider, filters)]);
  const filtered = Boolean(filters.status || filters.from || filters.to);

  return (
    <>
      <h1>Sales</h1>
      <section className={styles.headline} aria-labelledby="month-heading">
        <h2 id="month-heading">{month.month} so far</h2>
        <dl>
          <div>
            <dt>Sales</dt>
            <dd>{formatCents(month.totalCents)}</dd>
          </div>
          <div>
            <dt>You earned</dt>
            <dd>{formatCents(month.marginCents)}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{formatCents(month.feeCents)}</dd>
          </div>
          <div>
            <dt>Paid orders</dt>
            <dd data-testid="month-count">{month.count}</dd>
          </div>
        </dl>
        <p className={styles.muted}>By paid date, in your practice&apos;s time zone. Filters don&apos;t change these.</p>
      </section>

      <form method="get" action="/sales" className={styles.filters} aria-label="Filters">
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="expired">Expired</option>
            <option value="needs_review">Needs review</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label htmlFor="dateField">Date</label>
          <select id="dateField" name="dateField" defaultValue={filters.dateField}>
            <option value="created">Created</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div>
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div>
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div className={styles.filterButtons}>
          <button className="button">Apply filters</button>
          {filtered && <a href="/sales">Clear filters</a>}
        </div>
      </form>

      <SalesList
        key={JSON.stringify(filters)}
        filters={filters}
        filtered={filtered}
        initial={withLinks(first)}
        timeZone={provider.timeZone}
      />
    </>
  );
}
