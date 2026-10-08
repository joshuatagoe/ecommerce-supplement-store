"use client";

// F4: the summary of the view, then the order list with search, each status's
// action, a count that's announced, and numbered pages (L5). Search text stays
// in this component and the request body; it never reaches the URL (§8), so
// while a search is on, its pages are buttons rather than links.
import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "react-aria-components";
import type { SalesFilters } from "@/server/reporting";
import { formatDate } from "@/shared/dates";
import { formatCents } from "@/shared/money";
import { ACTION_LABELS } from "@/shared/status";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { StatusBadge } from "@/ui/components/StatusBadge";
import { cancelOrderAction, discardDraftAction, newLinkAction, orderAgainAction } from "../orders/[ref]/actions";
import { searchOrdersAction } from "./actions";
import type { SalesPage, SalesRowView } from "./links";
import styles from "./sales.module.css";

type Props = {
  filters: SalesFilters;
  filtered: boolean;
  initial: SalesPage;
  timeZone: string;
  /** What the filters select, in words: a shortcut's name, "Your filters" or "All orders". */
  view: string;
  productName: string | null;
  /** The filters as a query string, for the page links. */
  pageQuery: string;
};

const DATE_LABEL = { created: "Created", sent: "Sent", paid: "Paid" } as const;

/** Page numbers to offer: all of them when few, else the ends and the neighbours of the current one. */
function pageNumbers(current: number, last: number): (number | "gap")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const shown = [...new Set([1, current - 1, current, current + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return shown.flatMap((n, i) => (i > 0 && n - shown[i - 1] > 1 ? ["gap" as const, n] : [n]));
}

export function SalesList({ filters, filtered, initial, timeZone, view, productName, pageQuery }: Props) {
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await searchOrdersAction({ ...filters, text: text.trim() || undefined, page: undefined });
      if (result.ok) {
        setPage(result.page);
        setSearched(text.trim());
      } else {
        setError(result.error.message);
      }
    });
  }

  /** A page of search results; the filters' own pages are links instead. */
  function goTo(number: number) {
    startTransition(async () => {
      const result = await searchOrdersAction({ ...filters, text: searched || undefined, page: number });
      if (result.ok) setPage(result.page);
    });
  }

  function run(action: (input: { ref: string }) => Promise<unknown>, ref: string) {
    setError(null);
    startTransition(async () => {
      const result = (await action({ ref })) as { ok: boolean; error?: { message: string } } | undefined;
      if (result && !result.ok) setError(result.error?.message ?? "Something went wrong. Try again.");
    });
  }

  async function copy(row: SalesRowView) {
    if (!row.link) return;
    await navigator.clipboard.writeText(row.link).catch(() => {});
    setMessage(`Link copied for ${row.ref}`);
  }

  const nothingYet = page.count === 0 && !filtered && !searched;
  const dateOf = (row: SalesRowView) =>
    ({ created: row.createdAt, sent: row.sentAt, paid: row.paidAt })[filters.dateField];
  const firstShown = (page.page - 1) * page.pageSize + 1;
  const pageHref = (number: number) => `/sales?${pageQuery ? `${pageQuery}&` : ""}page=${number}#orders-heading`;

  return (
    <>
      <section aria-labelledby="summary-heading" className={styles.summary}>
        <h2 id="summary-heading">Summary</h2>
        <p className={styles.view} data-testid="summary-view">
          {view}
          {searched ? ", matching your search" : ""}
        </p>
        <dl>
          <div>
            <dt>Orders</dt>
            <dd data-testid="summary-orders">{page.count}</dd>
          </div>
          <div>
            <dt>Paid orders</dt>
            <dd data-testid="summary-paid">{page.paid.count}</dd>
          </div>
          <div>
            <dt>Sales</dt>
            <dd data-testid="summary-sales">{formatCents(page.paid.totalCents)}</dd>
          </div>
          <div>
            <dt>You earned</dt>
            <dd data-testid="summary-earned">{formatCents(page.paid.marginCents)}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{formatCents(page.paid.feeCents)}</dd>
          </div>
        </dl>
        {page.product && (
          <>
            <h3 className={styles.productHeading}>{productName ?? "This product"} in those paid orders</h3>
            <dl>
              <div>
                <dt>Bottles sold</dt>
                <dd data-testid="summary-bottles">{page.product.bottles}</dd>
              </div>
              <div>
                <dt>Sales</dt>
                <dd>{formatCents(page.product.totalCents)}</dd>
              </div>
              <div>
                <dt>You earned</dt>
                <dd>{formatCents(page.product.marginCents)}</dd>
              </div>
            </dl>
          </>
        )}
        <p className={styles.muted}>Sales, earnings and fees count paid orders only. Dates are in your practice&apos;s time zone.</p>
      </section>

    <section aria-labelledby="orders-heading" className={styles.orders}>
      <h2 id="orders-heading">Orders</h2>
      <form role="search" onSubmit={search} className={styles.search}>
        <label htmlFor="sales-search">Search by patient or order ref</label>
        <div>
          <input
            id="sales-search"
            type="search"
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button className="button" disabled={pending}>
            Search
          </button>
        </div>
      </form>

      <p className={styles.count} role="status">
        {page.count} {page.count === 1 ? "order" : "orders"}
      </p>
      <p className="visually-hidden" role="status">
        {message}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {nothingYet ? (
        <p className={styles.empty}>
          No orders yet. <Link href="/orders/new">Start a new order</Link>.
        </p>
      ) : page.count === 0 ? (
        <p className={styles.empty}>
          No orders match. <a href="/sales">Clear filters</a>
          {searched ? " or change the search" : ""}.
        </p>
      ) : (
        <>
          <div className={styles.tableWrap} role="region" aria-labelledby="orders-heading" tabIndex={0}>
            <table className={styles.table}>
              <caption className="visually-hidden">Orders, newest first by {DATE_LABEL[filters.dateField].toLowerCase()} date</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Patient</th>
                  <th scope="col">{DATE_LABEL[filters.dateField]}</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.num}>
                    Total
                  </th>
                  <th scope="col" className={styles.num}>
                    You earned
                  </th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.ref}>
                    <th scope="row">
                      <Link href={`/orders/${row.ref}`} className={styles.ref}>
                        {row.ref}
                      </Link>
                    </th>
                    <td>{row.patientName}</td>
                    <td className={styles.date}>{dateOf(row) ? formatDate(dateOf(row)!, timeZone) : "—"}</td>
                    <td>
                      <StatusBadge status={row.display} />
                      {row.display === "sent" && row.linkExpiresAt && (
                        <span className={styles.muted}>expires {formatDate(row.linkExpiresAt, timeZone)}</span>
                      )}
                    </td>
                    <td className={styles.num}>{formatCents(row.totalCents)}</td>
                    <td className={styles.num}>{row.marginCents === null ? "—" : formatCents(row.marginCents)}</td>
                    <td>
                      <div className={styles.actions}>
                        {row.actions.map((action) => {
                          const label = `${ACTION_LABELS[action]}: ${row.ref}`;
                          switch (action) {
                            case "continue":
                              return (
                                <Link key={action} href={`/orders/${row.ref}`} className="button" aria-label={label}>
                                  Continue
                                </Link>
                              );
                            case "copy_link":
                              return (
                                <Button key={action} className="button" aria-label={label} onPress={() => copy(row)}>
                                  Copy link
                                </Button>
                              );
                            case "order_again":
                              return (
                                <Button
                                  key={action}
                                  className="button"
                                  aria-label={label}
                                  isDisabled={pending}
                                  onPress={() => run(orderAgainAction, row.ref)}
                                >
                                  Order again
                                </Button>
                              );
                            case "new_link":
                              return (
                                <ConfirmDialog
                                  key={action}
                                  action="New link"
                                  triggerLabel={label}
                                  title="Make a new link?"
                                  keepLabel="Keep this link"
                                  onConfirm={() => run(newLinkAction, row.ref)}
                                >
                                  <p>The current link for {row.ref} stops working, and the new one works for 30 days.</p>
                                </ConfirmDialog>
                              );
                            case "cancel_order":
                              return (
                                <ConfirmDialog
                                  key={action}
                                  action="Cancel order"
                                  triggerLabel={label}
                                  title="Cancel this order?"
                                  keepLabel="Keep order"
                                  onConfirm={() => run(cancelOrderAction, row.ref)}
                                >
                                  <p>{row.patientName}&apos;s link will stop working. You can&apos;t undo this.</p>
                                </ConfirmDialog>
                              );
                            case "discard_draft":
                              return (
                                <ConfirmDialog
                                  key={action}
                                  action="Discard draft"
                                  triggerLabel={label}
                                  title="Discard this draft?"
                                  keepLabel="Keep draft"
                                  onConfirm={() => run(discardDraftAction, row.ref)}
                                >
                                  <p>The draft for {row.patientName} will be thrown away. You can&apos;t undo this.</p>
                                </ConfirmDialog>
                              );
                          }
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pages" className={styles.pager}>
            <p>
              {firstShown}–{firstShown + page.rows.length - 1} of {page.count}
            </p>
            {page.pageCount > 1 && (
              <ul>
                {page.page > 1 && (
                  <li>
                    {searched ? (
                      <Button className="button" isDisabled={pending} onPress={() => goTo(page.page - 1)}>
                        Previous
                      </Button>
                    ) : (
                      <Link className="button" href={pageHref(page.page - 1)}>
                        Previous
                      </Link>
                    )}
                  </li>
                )}
                {pageNumbers(page.page, page.pageCount).map((number, i) =>
                  number === "gap" ? (
                    <li key={`gap-${i}`} aria-hidden="true">
                      …
                    </li>
                  ) : (
                    <li key={number}>
                      {number === page.page ? (
                        <span className={styles.current} aria-current="page">
                          {number}
                        </span>
                      ) : searched ? (
                        <Button className="button" aria-label={`Page ${number}`} isDisabled={pending} onPress={() => goTo(number)}>
                          {number}
                        </Button>
                      ) : (
                        <Link className="button" aria-label={`Page ${number}`} href={pageHref(number)}>
                          {number}
                        </Link>
                      )}
                    </li>
                  ),
                )}
                {page.page < page.pageCount && (
                  <li>
                    {searched ? (
                      <Button className="button" isDisabled={pending} onPress={() => goTo(page.page + 1)}>
                        Next
                      </Button>
                    ) : (
                      <Link className="button" href={pageHref(page.page + 1)}>
                        Next
                      </Link>
                    )}
                  </li>
                )}
              </ul>
            )}
          </nav>
        </>
      )}
    </section>
    </>
  );
}
