// Payments (ARCHITECTURE.md §3, §5): attempts, Pay keys and the sweep. The
// attempt is saved before any money moves, the charge uses the attempt's own
// ID as the payment company's idempotency key, and success is recorded with
// conditional writes in one transaction. Payments asks for an order to be
// marked paid only through those writes, and never sets a status any other way.
//
// What the patient is told (D23): only an answer the payment company actually
// gave is "declined"; only a failure before the attempt was saved is
// "not_charged"; anything unexplained is "confirming".
import { and, asc, eq, inArray, lt, TransactionRollbackError } from "drizzle-orm";
import { type PayPageState, payPageState } from "../../shared/status.ts";
import type { ActionResult } from "../../shared/schemas.ts";
import type { Db, Tx } from "../db/client.ts";
import { notifyStatusChange } from "../db/notify.ts";
import { catalogItems, orderEvents, orderLines, orders, paymentAttempts, practices, providers } from "../db/schema.ts";
import { orderForToken } from "../links/index.ts";
import { logStatusChange } from "../log.ts";
import type { Inventory } from "../ports/inventory.ts";
import type { Card, PaymentGateway } from "../ports/payment-gateway.ts";

export type PaymentsContext = {
  db: Db;
  now: () => Date;
  gateway: PaymentGateway;
  /** Told what sold, in the same transaction that marks an order paid (D84). */
  inventory: Inventory;
  /** How long Pay waits for the payment company (PAYMENT_TIMEOUT_MS). */
  paymentTimeoutMs: number;
  /** How long an attempt may stay pending before the sweep asks about it (SWEEP_AFTER_MS). */
  sweepAfterMs: number;
  linkSigningKey: string;
  /** The request this work is for, on its log lines (§11, D85); none for the sweep. */
  requestId?: string;
  /** Tests only: a way to make step 5 fail after the payment company approved. */
  hooks?: { beforeRecordSuccess?: () => Promise<void> };
};

export type PayOutcome = "paid" | "declined" | "not_charged" | "in_progress" | "confirming";

type AttemptStatus = "pending" | "succeeded" | "declined" | "failed";

const OUTCOME_OF: Record<AttemptStatus, PayOutcome> = {
  pending: "confirming",
  succeeded: "paid",
  declined: "declined",
  failed: "not_charged",
};

const outcome = (value: PayOutcome) => ({ ok: true as const, outcome: value });

class Timeout extends Error {}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`No answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string };
  return pgError?.code === "23505" && pgError.constraint === constraint;
}

async function attemptByKey(db: Db | Tx, payKey: string) {
  const [attempt] = await db
    .select({ id: paymentAttempts.id, orderId: paymentAttempts.orderId, status: paymentAttempts.status })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.idempotencyKey, payKey));
  return attempt ?? null;
}

// ----------------------------------------------------------------------- pay

type PayInput = { token: string; payKey: string; card: Card };
type Started = { attemptId: string; orderId: string; ref: string; amountCents: number };

/** §5 Pay: steps 1–6. The browser never sends an amount; the attempt charges the order's frozen total. */
export async function pay(ctx: PaymentsContext, input: PayInput): Promise<ActionResult<{ outcome: PayOutcome }>> {
  // Steps 1–3. Any failure here happens before money could move.
  let started: Started | PayOutcome;
  try {
    const linked = await orderForToken(ctx.db, ctx.linkSigningKey, input.token);
    if (!linked) return { ok: false, error: { code: "NOT_FOUND", message: "This link isn't valid." } };
    if (ctx.gateway.acceptsCard && !ctx.gateway.acceptsCard(input.card.number)) {
      return {
        ok: false,
        error: { code: "INVALID_INPUT", field: "card.number", message: "Use one of the test cards listed below." },
      };
    }
    started = await startAttempt(ctx, linked.id, input.payKey);
  } catch (error) {
    if (isUniqueViolation(error, "payment_attempts_pay_key_once")) {
      // The same request twice at the same moment: answer with the first one's result (§5 guard 1).
      const prior = await attemptByKey(ctx.db, input.payKey).catch(() => null);
      return outcome(prior ? OUTCOME_OF[prior.status] : "confirming");
    }
    if (isUniqueViolation(error, "one_live_attempt_per_order")) return outcome("in_progress");
    return outcome("not_charged");
  }
  if (typeof started === "string") return outcome(started);

  // Step 4. The attempt's own ID is the idempotency key, so a repeat can't charge twice.
  let answer;
  try {
    answer = await within(
      ctx.gateway.charge({ idempotencyKey: started.attemptId, amountCents: started.amountCents, card: input.card }),
      ctx.paymentTimeoutMs,
    );
  } catch {
    // No clear answer: the money may or may not have moved. The sweep finds out.
    await markNeedsReview(ctx, started).catch(() => {});
    return outcome("confirming");
  }

  if (answer.outcome === "declined") {
    // The payment company said no, so the patient can be told so even if this write fails;
    // the sweep would then find no charge and fail the attempt.
    await recordDecline(ctx, started.attemptId).catch(() => {});
    return outcome("declined");
  }

  // Step 5.
  try {
    await ctx.hooks?.beforeRecordSuccess?.();
    const recorded = await recordSuccess(ctx, started, answer.chargeRef, "request");
    return outcome(recorded ? "paid" : "confirming");
  } catch {
    return outcome("confirming");
  }
}

/** Steps 2–3: lock the order, check it can be paid, and save the attempt as pending. */
async function startAttempt(ctx: PaymentsContext, orderId: string, payKey: string): Promise<Started | PayOutcome> {
  return ctx.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    // The same Pay key again, such as a double click: return its result (§5 guard 1).
    const prior = await attemptByKey(tx, payKey);
    if (prior) return prior.orderId === order.id ? OUTCOME_OF[prior.status] : "not_charged";

    if (order.status === "paid") return "paid";
    if (order.status === "needs_review") return "in_progress";
    if (order.status !== "sent") return "not_charged";
    // A link can start a payment until it expires, 90 days after it was sent (§6, D87).
    if (order.linkExpiresAt!.getTime() <= ctx.now().getTime()) return "not_charged";
    const [live] = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, "pending")))
      .limit(1);
    // Two tabs or two phones: the second never reaches the payment company (§5 guard 2).
    if (live) return "in_progress";

    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        orderId: order.id,
        idempotencyKey: payKey,
        amountCents: order.totalCents!,
        status: "pending",
        createdAt: ctx.now(),
      })
      .returning({ id: paymentAttempts.id });
    return { attemptId: attempt.id, orderId: order.id, ref: order.ref, amountCents: order.totalCents! };
  });
}

/**
 * §5 step 5, used by both Pay and the sweep: the attempt succeeds and the order
 * is paid, each only from the state it must be in. If either write changes no
 * row, someone else already recorded it, and nothing is written twice.
 */
async function recordSuccess(
  ctx: PaymentsContext,
  attempt: { attemptId: string; orderId: string; ref: string },
  chargeRef: string,
  settledBy: "request" | "sweep",
): Promise<boolean> {
  const now = ctx.now();
  const from = await ctx.db
    .transaction(async (tx) => {
      const succeeded = await tx
        .update(paymentAttempts)
        .set({ status: "succeeded", chargeRef, settledBy, settledAt: now })
        .where(and(eq(paymentAttempts.id, attempt.attemptId), eq(paymentAttempts.status, "pending")))
        .returning({ id: paymentAttempts.id });
      const [before] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, attempt.orderId));
      const paid = await tx
        .update(orders)
        .set({ status: "paid", paidAt: now, paidAttemptId: attempt.attemptId, updatedAt: now })
        .where(and(eq(orders.id, attempt.orderId), inArray(orders.status, ["sent", "needs_review"])))
        .returning({ id: orders.id });
      if (succeeded.length !== 1 || paid.length !== 1) {
        tx.rollback();
      }
      await tx.insert(orderEvents).values({
        orderId: attempt.orderId,
        kind: "paid",
        actorType: settledBy === "request" ? "patient" : "sweep",
        at: now,
        details: { attemptId: attempt.attemptId, settledBy },
      });
      // Only the write that actually marked the order paid gets here, so inventory hears once (D84).
      const sold = await tx
        .select({ catalogItemId: orderLines.catalogItemId, name: catalogItems.name, quantity: orderLines.quantity })
        .from(orderLines)
        .innerJoin(catalogItems, eq(catalogItems.id, orderLines.catalogItemId))
        .where(eq(orderLines.orderId, attempt.orderId))
        .orderBy(asc(catalogItems.name));
      await ctx.inventory.recordSale(tx, { orderId: attempt.orderId, ref: attempt.ref, lines: sold, at: now });
      await notifyStatusChange(tx, attempt.ref);
      return before.status;
    })
    .catch((error: unknown) => {
      if (error instanceof TransactionRollbackError) return null;
      throw error;
    });
  if (from === null) return false;
  logStatusChange({ ref: attempt.ref, from, to: "paid", actor: settledBy === "request" ? "patient" : "sweep", requestId: ctx.requestId });
  return true;
}

async function recordDecline(ctx: PaymentsContext, attemptId: string): Promise<void> {
  await ctx.db
    .update(paymentAttempts)
    .set({ status: "declined", settledBy: "request", settledAt: ctx.now() })
    .where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.status, "pending")));
}

/** No clear answer from the payment company: the order needs review until the sweep settles it. */
async function markNeedsReview(ctx: PaymentsContext, attempt: { attemptId: string; orderId: string; ref: string }): Promise<void> {
  const changed = await ctx.db.transaction(async (tx) => {
    const moved = await tx
      .update(orders)
      .set({ status: "needs_review", updatedAt: ctx.now() })
      .where(and(eq(orders.id, attempt.orderId), eq(orders.status, "sent")))
      .returning({ id: orders.id });
    if (moved.length === 0) return false;
    await tx.insert(orderEvents).values({
      orderId: attempt.orderId,
      kind: "needs_review",
      actorType: "system",
      at: ctx.now(),
      details: { attemptId: attempt.attemptId },
    });
    await notifyStatusChange(tx, attempt.ref);
    return true;
  });
  if (changed) logStatusChange({ ref: attempt.ref, from: "sent", to: "needs_review", actor: "system", requestId: ctx.requestId });
}

// --------------------------------------------------------------------- sweep

export type SweepResult = { checked: number; paid: number; failed: number; unresolved: number };

/**
 * §5 The sweep: asks the payment company about every attempt pending longer
 * than SWEEP_AFTER_MS, using lookup and never a second charge, then settles
 * it with the same conditional writes as Pay. One it can't settle leaves its
 * order in needs review for a person.
 */
export async function sweep(ctx: PaymentsContext): Promise<SweepResult> {
  const cutoff = new Date(ctx.now().getTime() - ctx.sweepAfterMs);
  const stuck = await ctx.db
    .select({ attemptId: paymentAttempts.id, orderId: paymentAttempts.orderId, ref: orders.ref })
    .from(paymentAttempts)
    .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
    .where(and(eq(paymentAttempts.status, "pending"), lt(paymentAttempts.createdAt, cutoff)))
    .orderBy(asc(paymentAttempts.createdAt))
    .limit(100);

  const result: SweepResult = { checked: stuck.length, paid: 0, failed: 0, unresolved: 0 };
  for (const attempt of stuck) {
    let answer;
    try {
      answer = await within(ctx.gateway.lookup(attempt.attemptId), ctx.paymentTimeoutMs);
    } catch {
      result.unresolved += 1;
      await markNeedsReview(ctx, attempt).catch(() => {});
      continue;
    }
    if (answer.status === "charged") {
      if (await recordSuccess(ctx, attempt, answer.chargeRef, "sweep")) result.paid += 1;
    } else if (await recordNotCharged(ctx, attempt)) {
      result.failed += 1;
    }
  }
  return result;
}

/** Confirmed not charged: the attempt fails, and an order in needs review goes back to sent, so Sam can pay again. */
async function recordNotCharged(ctx: PaymentsContext, attempt: { attemptId: string; orderId: string; ref: string }) {
  const now = ctx.now();
  const reopened = await ctx.db.transaction(async (tx) => {
    const failed = await tx
      .update(paymentAttempts)
      .set({ status: "failed", settledBy: "sweep", settledAt: now })
      .where(and(eq(paymentAttempts.id, attempt.attemptId), eq(paymentAttempts.status, "pending")))
      .returning({ id: paymentAttempts.id });
    if (failed.length === 0) return null;
    const back = await tx
      .update(orders)
      .set({ status: "sent", updatedAt: now })
      .where(and(eq(orders.id, attempt.orderId), eq(orders.status, "needs_review")))
      .returning({ id: orders.id });
    await tx.insert(orderEvents).values({
      orderId: attempt.orderId,
      kind: "payment_not_charged",
      actorType: "sweep",
      at: now,
      details: { attemptId: attempt.attemptId },
    });
    await notifyStatusChange(tx, attempt.ref);
    return back.length === 1;
  });
  if (reopened) logStatusChange({ ref: attempt.ref, from: "needs_review", to: "sent", actor: "sweep", requestId: ctx.requestId });
  return reopened !== null;
}

// ------------------------------------------------------------------- reading

export type PayPage = {
  ref: string;
  state: Exclude<PayPageState, "invalid">;
  providerName: string;
  practiceName: string;
  /** Dates on the receipt are shown in the practice's time zone (D29). */
  timeZone: string;
  lines: { productName: string; imagePath: string; imageAlt: string; quantity: number; unitPriceCents: number; unitMsrpCents: number }[];
  totalCents: number;
  savingsCents: number;
  linkExpiresAt: Date;
  paidAt: Date | null;
};

/**
 * What a link shows (§6), or null when the link isn't valid. Only this order,
 * and never the patient's name (D30).
 */
export async function payPage(ctx: Pick<PaymentsContext, "db" | "now" | "linkSigningKey">, token: string): Promise<PayPage | null> {
  const linked = await orderForToken(ctx.db, ctx.linkSigningKey, token);
  if (!linked) return null;
  const [row] = await ctx.db
    .select({
      order: orders,
      providerName: providers.displayName,
      practiceName: practices.name,
      timeZone: practices.timeZone,
    })
    .from(orders)
    .innerJoin(providers, eq(providers.id, orders.providerId))
    .innerJoin(practices, eq(practices.id, orders.practiceId))
    .where(eq(orders.id, linked.id));
  const order = row.order;
  const [pending] = await ctx.db
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, "pending")))
    .limit(1);
  const state = payPageState(
    { status: order.status, linkExpiresAt: order.linkExpiresAt, paymentInProgress: Boolean(pending) },
    ctx.now(),
  );
  if (state === "invalid") return null;

  const lines = await ctx.db
    .select({
      productName: orderLines.productName,
      imagePath: orderLines.imagePath,
      imageAlt: orderLines.imageAlt,
      quantity: orderLines.quantity,
      unitPriceCents: orderLines.unitPriceCents,
      unitMsrpCents: orderLines.unitMsrpCents,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id))
    .orderBy(asc(orderLines.id));
  const frozen = lines.map((line) => ({
    productName: line.productName!,
    imagePath: line.imagePath!,
    imageAlt: line.imageAlt!,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    unitMsrpCents: line.unitMsrpCents!,
  }));
  return {
    ref: order.ref,
    state,
    providerName: row.providerName,
    practiceName: row.practiceName,
    timeZone: row.timeZone,
    lines: frozen,
    totalCents: order.totalCents!,
    savingsCents: frozen.reduce((sum, line) => sum + (line.unitMsrpCents - line.unitPriceCents) * line.quantity, 0),
    linkExpiresAt: order.linkExpiresAt!,
    paidAt: order.paidAt,
  };
}
