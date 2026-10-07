"use client";

// A sent order (or one past Send): its status, its link with Copy link, and
// the actions its status allows (§8). The full split and the audit trail are
// Order details (M5).
import { useState, useTransition } from "react";
import { Button } from "react-aria-components";
import type { OrderView } from "@/server/orders";
import { formatDate } from "@/shared/dates";
import { formatCents } from "@/shared/money";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { ProductImage } from "@/ui/components/ProductImage";
import { StatusBadge } from "@/ui/components/StatusBadge";
import { cancelOrderAction, newLinkAction, orderAgainAction } from "./actions";
import styles from "./order.module.css";

type Props = { order: OrderView; notice?: string; timeZone: string };

/** One verb per action (§4): Send → "Sent", Cancel order → "Order cancelled", Discard draft → "Draft discarded". */
function noticeText(notice: string | undefined, order: OrderView): string | null {
  switch (notice) {
    case "sent":
      return order.status === "sent" ? `Sent to ${order.patient.name}.` : null;
    case "new-link":
      return "New link made. The old link no longer works.";
    case "cancelled":
      return "Order cancelled.";
    case "discarded":
      return "Draft discarded.";
    default:
      return null;
  }
}

export function OrderSummary({ order, notice, timeZone }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const message = noticeText(notice, order);
  const can = (action: string) => order.actions.includes(action as never);

  function run(action: (input: { ref: string }) => Promise<{ ok: boolean; error?: { message: string } } | undefined>) {
    setError(null);
    startTransition(async () => {
      const result = await action({ ref: order.ref });
      if (result && !result.ok) setError(result.error?.message ?? "Something went wrong. Try again.");
    });
  }

  async function copy() {
    if (!order.link) return;
    try {
      await navigator.clipboard.writeText(order.link);
    } catch {
      // Without clipboard access, select the link so the provider can copy it themselves.
      const field = document.getElementById("pay-link") as HTMLInputElement | null;
      field?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
  }

  return (
    <>
      <p className={styles.ref}>
        Order <span data-testid="order-ref">{order.ref}</span>
      </p>
      <div className={styles.titleRow}>
        <h1>Order for {order.patient.name}</h1>
        <StatusBadge status={order.display} />
      </div>

      <p className={styles.notice} role="status">
        {message}
      </p>
      {error && (
        <p className={styles.errorSummary} role="alert">
          {error}
        </p>
      )}

      {order.display === "sent" && order.link && (
        <div className={styles.linkBox}>
          <h2>Pay link</h2>
          <label htmlFor="pay-link" className="visually-hidden">
            Pay link
          </label>
          <div className={styles.linkRow}>
            <input id="pay-link" readOnly value={order.link} onFocus={(event) => event.currentTarget.select()} />
            <Button className="button button-primary" onPress={copy}>
              Copy link
            </Button>
          </div>
          <p className={styles.copied} role="status">
            {copied ? "Link copied" : ""}
          </p>
          <p className={styles.muted}>
            The link works until {formatDate(order.linkExpiresAt!, timeZone)}. Email is stubbed in this demo, so copy the
            link and send it to {order.patient.name} yourself.
          </p>
        </div>
      )}
      {order.display === "expired" && (
        <p className={styles.notice}>
          The link expired on {formatDate(order.linkExpiresAt!, timeZone)}. Make a new link to send the order again.
        </p>
      )}
      {order.display === "needs_review" && (
        <p className={styles.notice}>Needs review. We&apos;re confirming a payment; there&apos;s nothing for you to do.</p>
      )}
      {order.display === "paid" && (
        <p className={styles.notice}>Paid. You earned {formatCents(order.totals.marginCents)}.</p>
      )}

      {(can("new_link") || can("cancel_order") || can("order_again")) && (
        <div className={styles.actions}>
          {can("new_link") && (
            <ConfirmDialog
              action="New link"
              title="Make a new link?"
              keepLabel="Keep this link"
              isDisabled={pending}
              onConfirm={() => run(newLinkAction)}
            >
              <p>The current link stops working, and the new one works for 30 days.</p>
            </ConfirmDialog>
          )}
          {can("cancel_order") && (
            <ConfirmDialog
              action="Cancel order"
              title="Cancel this order?"
              keepLabel="Keep order"
              isDisabled={pending}
              onConfirm={() => run(cancelOrderAction)}
            >
              <p>{order.patient.name}&apos;s link will stop working. You can&apos;t undo this.</p>
            </ConfirmDialog>
          )}
          {can("order_again") && (
            <Button className="button" isDisabled={pending} onPress={() => run(orderAgainAction)}>
              Order again
            </Button>
          )}
        </div>
      )}

      <section aria-labelledby="lines-heading" className={styles.section}>
        <h2 id="lines-heading">Items</h2>
        <div className={styles.tableWrap} role="region" aria-labelledby="lines-heading" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className={styles.num}>
                  Quantity
                </th>
                <th scope="col" className={styles.num}>
                  Price
                </th>
                <th scope="col" className={styles.num}>
                  Total
                </th>
                <th scope="col" className={styles.num}>
                  You earn
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.catalogItemId}>
                  <th scope="row">
                    <span className={styles.productCell}>
                      <ProductImage src={line.imagePath} alt="" size={36} />
                      <span>
                        {line.name}
                        <span className={styles.muted}>{line.sizeLabel}</span>
                      </span>
                    </span>
                  </th>
                  <td className={styles.num}>{line.quantity}</td>
                  <td className={styles.num}>{formatCents(line.priceCents)}</td>
                  <td className={styles.num}>{formatCents(line.split.priceCents)}</td>
                  <td className={styles.num}>{formatCents(line.split.marginCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Order total
                </th>
                <td className={styles.num}>{formatCents(order.totals.priceCents)}</td>
                <td className={styles.num}>{formatCents(order.totals.marginCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
