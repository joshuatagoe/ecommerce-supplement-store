import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { linkSigningKey, paymentsMode } from "@/server/config";
import { db } from "@/server/db/client";
import { type PayPage as PayView, payPage } from "@/server/payments";
import { formatDate } from "@/shared/dates";
import { formatCents } from "@/shared/money";
import { DemoBanner } from "@/ui/components/DemoBanner";
import { ProductImage } from "@/ui/components/ProductImage";
import { TEST_CARDS } from "@/server/adapters/stub-payments";
import { Confirming } from "./Confirming";
import { ErrorSummary } from "./ErrorSummary";
import { PayForm } from "./PayForm";
import styles from "./pay.module.css";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ notice?: string }> };

const load = cache((token: string) => payPage({ db, now: () => new Date(), linkSigningKey: linkSigningKey() }, token));

const TITLES: Record<PayView["state"], string> = {
  checkout: "Pay",
  confirming: "Confirming payment",
  paid: "Paid",
  cancelled: "Order cancelled",
  expired: "Link expired",
};

/** The page title changes with each state (§9), e.g. "Paid · Lakeview Family Practice". */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await load((await params).token);
  return { title: view ? `${TITLES[view.state]} · ${view.practiceName}` : "Link not valid" };
}

const NOTICES: Record<string, string> = {
  declined: "Your card was declined. You haven't been charged. Try another card.",
  "not-charged": "We couldn't take your payment. You haven't been charged. Please try again in a few minutes.",
  retry: "Your payment didn't go through. You haven't been charged.",
};

/** §6: one order, in one of six states. A link that fails its signature is a 404 that reveals nothing. */
export default async function PayPage({ params, searchParams }: Props) {
  const { token } = await params;
  const view = await load(token);
  if (!view) notFound();
  const { notice } = await searchParams;

  return (
    <>
      <header className={styles.store}>
        <p>{view.practiceName}</p>
      </header>
      <DemoBanner />
      <main id="main" className={styles.main}>
        {view.state === "checkout" && (
          <>
            <h1>Recommended by {view.providerName}</h1>
            <p className={styles.lede}>{view.practiceName} put this order together for you.</p>
            <Items view={view} />
            {notice && NOTICES[notice] && <ErrorSummary message={NOTICES[notice]} />}
            <PayForm token={token} payKey={randomUUID()} totalLabel={formatCents(view.totalCents)} />
            {paymentsMode() === "stub" && <TestCards />}
            <p className={styles.help}>Questions about this order? Contact {view.practiceName}.</p>
          </>
        )}

        {view.state === "confirming" && <Confirming token={token} />}

        {view.state === "paid" && (
          <>
            <span className={`${styles.mark} ${styles.paidMark}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <h1>{notice === "paid" ? "Thank you. Your payment went through." : "Already paid"}</h1>
            <p className={styles.lede}>
              {notice === "paid" ? "Here's your receipt." : "This order is paid. Here's your receipt."}
            </p>
            <dl className={styles.receipt}>
              <div>
                <dt>Order</dt>
                <dd>{view.ref}</dd>
              </div>
              <div>
                <dt>Paid on</dt>
                <dd>{view.paidAt ? formatDate(view.paidAt, view.timeZone) : ""}</dd>
              </div>
              <div>
                <dt>Total paid</dt>
                <dd data-testid="paid-total">{formatCents(view.totalCents)}</dd>
              </div>
            </dl>
            <Items view={view} />
            <p className={styles.help}>Questions about this order? Contact {view.practiceName}.</p>
          </>
        )}

        {view.state === "cancelled" && (
          <>
            <h1>This order is no longer available</h1>
            <p className={styles.lede}>Contact {view.practiceName} if you still need these items.</p>
          </>
        )}

        {view.state === "expired" && (
          <>
            <h1>This link has expired</h1>
            <p className={styles.lede}>Contact {view.providerName}&apos;s clinic for a new one.</p>
          </>
        )}
      </main>
    </>
  );
}

/** Each item with its price, the retail price struck through (read as "Retail price $40.00"), and the saving. */
function Items({ view }: { view: PayView }) {
  return (
    <>
      <ul className={styles.items}>
        {view.lines.map((line) => (
          <li key={line.productName} className={styles.item}>
            <ProductImage src={line.imagePath} alt={line.imageAlt} size={72} />
            <div className={styles.itemName}>
              <p>{line.productName}</p>
              <p className={styles.muted}>Quantity {line.quantity}</p>
            </div>
            <div className={styles.itemPrice}>
              <p className={styles.price}>{formatCents(line.unitPriceCents * line.quantity)}</p>
              {line.unitMsrpCents > line.unitPriceCents && (
                <>
                  <p className={styles.muted}>
                    <s aria-hidden="true">{formatCents(line.unitMsrpCents * line.quantity)}</s>
                    <span className="visually-hidden">Retail price {formatCents(line.unitMsrpCents * line.quantity)}</span>
                  </p>
                  <p className={styles.save}>You save {formatCents((line.unitMsrpCents - line.unitPriceCents) * line.quantity)}</p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.total}>
        <span>Total</span> <strong data-testid="pay-total">{formatCents(view.totalCents)}</strong>
      </p>
      {view.savingsCents > 0 && (
        <p className={styles.muted}>You save {formatCents(view.savingsCents)} compared with retail prices.</p>
      )}
    </>
  );
}

/** Stub mode only (the user's call, M4 grill): graders can't find the test cards otherwise. */
function TestCards() {
  return (
    <details className={styles.testCards}>
      <summary>Test cards</summary>
      <p>This demo takes no real cards. Use any future expiry date, any 3-digit security code and any ZIP code.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Card number</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(TEST_CARDS).map(([number, card]) => (
            <tr key={number}>
              <td className={styles.cardNumber}>{number.replace(/(\d{4})(?=\d)/g, "$1 ")}</td>
              <td>{card.shows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
