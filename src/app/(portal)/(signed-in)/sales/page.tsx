import type { Metadata } from "next";
import { db } from "@/server/db/client";
import { searchOrders, soldProducts } from "@/server/reporting";
import { type ShortcutParams, salesShortcuts } from "@/shared/sales-shortcuts";
import { searchOrdersInput } from "@/shared/schemas";
import { requireProvider } from "../../session";
import { withLinks } from "./links";
import { SalesList } from "./SalesList";
import styles from "./sales.module.css";

export const metadata: Metadata = { title: "Sales" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type UrlFilters = { status?: string; dateField?: string; from?: string; to?: string; product?: string };

/** The filters as a query string, in one fixed order, leaving out the defaults. */
function query({ status, dateField, from, to, product }: UrlFilters): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ status, dateField: dateField === "created" ? undefined : dateField, from, to, product })) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

/**
 * F4: shortcuts and filters, a summary of the view they select, then the
 * orders in numbered pages (L5). Filters and the page live in the URL; search
 * text doesn't (§8).
 */
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
    product: pick("product"),
    page: pick("page"),
  });
  const filters = parsed.success ? parsed.data : { dateField: "created" as const };
  const now = new Date();
  const ctx = { db, now: () => now };
  const [first, products] = await Promise.all([searchOrders(ctx, provider, filters), soldProducts(ctx, provider)]);
  const filtered = Boolean(filters.status || filters.from || filters.to || filters.product);

  // A shortcut is on when the filters are exactly its own; the product filter is kept either way.
  const shortcuts = salesShortcuts(now, provider.timeZone);
  const isOn = (p: ShortcutParams) =>
    p.status === filters.status && (p.dateField ?? "created") === filters.dateField && p.from === filters.from && p.to === filters.to;
  const active = shortcuts.find((shortcut) => isOn(shortcut.params));
  const productName = products.find((product) => product.id === filters.product)?.name ?? null;
  const view = active?.label ?? (filters.status || filters.from || filters.to ? "Your filters" : "All orders");

  return (
    <>
      <h1>Sales</h1>

      {/* Plain links, like the filter form: each loads the page fresh, so the fields always show the
          shortcut's values (an in-app navigation kept the old form's values). */}
      <nav aria-label="Shortcuts" className={styles.shortcuts}>
        <ul>
          {shortcuts.map((shortcut) => (
            <li key={shortcut.label}>
              <a
                href={`/sales?${query({ ...shortcut.params, product: filters.product })}`}
                aria-current={shortcut === active ? "true" : undefined}
              >
                {shortcut.label}
              </a>
            </li>
          ))}
          <li>
            <a href="/sales" aria-current={filtered ? undefined : "true"}>
              All orders
            </a>
          </li>
        </ul>
      </nav>

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
        <div>
          <label htmlFor="product">Product</label>
          <select id="product" name="product" defaultValue={filters.product ?? ""}>
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
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
        view={productName ? `${view}, ${productName}` : view}
        productName={productName}
        pageQuery={query({ ...filters, dateField: filters.dateField })}
      />
    </>
  );
}
