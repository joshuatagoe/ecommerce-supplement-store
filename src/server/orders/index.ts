// Orders (ARCHITECTURE.md §3, §4, §8): drafts, lines, Send, New link, Cancel
// order, Order again, and every status change. Each change locks the order's
// row first, writes its audit event in the same transaction, and announces
// itself through NOTIFY. Every query is limited to the provider who owns the
// order; another provider's order is NOT_FOUND, the same as a missing one.
// The clock comes from the context, so the seed can build history (M6).
import { and, asc, count, desc, eq, inArray, max, ne } from "drizzle-orm";
import { priceRangeMessage } from "../../shared/money.ts";
import {
  checkPrice,
  lineSplit,
  lowestPriceCents,
  orderTotals,
  priceForMarginCents,
  type Split,
  unitSplit,
} from "../../shared/pricing/index.ts";
import type { ActionError, ActionResult, ErrorCode, LineError } from "../../shared/schemas.ts";
import { type DisplayStatus, displayStatus, type OrderStatus, type SalesAction, salesActions } from "../../shared/status.ts";
import type { Db, Tx } from "../db/client.ts";
import { notifyStatusChange } from "../db/notify.ts";
import { catalogItems, orderEvents, orderLines, orders, patients, paymentAttempts, storeItems } from "../db/schema.ts";
import { payLink } from "../links/index.ts";
import { logStatusChange } from "../log.ts";
import type { LinkSender } from "../ports/link-sender.ts";
import type { PatientMatch } from "../ports/patient-directory.ts";
import { newRef } from "./refs.ts";

export type OrdersContext = {
  db: Db;
  now: () => Date;
  feeRateBps: number;
  linkSigningKey: string;
  appUrl: string;
  linkTtlDays: number;
  linkSender: LinkSender;
};

/** Who is acting: the signed-in provider (Access). */
export type ProviderRef = { id: string; practiceId: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(code: ErrorCode, message: string, extra: Partial<ActionError> = {}): { ok: false; error: ActionError } {
  return { ok: false, error: { code, message, ...extra } };
}

const NOT_FOUND = () => fail("NOT_FOUND", "We couldn't find that order.");
const PAYMENT_IN_PROGRESS = () =>
  fail("PAYMENT_IN_PROGRESS", "A payment for this order is being confirmed. Try again once it's settled.");

/** Locks the provider's order for the rest of the transaction (§5: per order, so it never slows anyone else). */
async function lockOrder(tx: Tx, provider: ProviderRef, ref: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.ref, ref), eq(orders.providerId, provider.id)))
    .for("update");
  return order ?? null;
}

async function hasPendingAttempt(tx: Tx | Db, orderId: string): Promise<boolean> {
  const [pending] = await tx
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderId, orderId), eq(paymentAttempts.status, "pending")))
    .limit(1);
  return Boolean(pending);
}

function event(orderId: string, kind: string, provider: ProviderRef, at: Date, details: Record<string, unknown> | null = null) {
  return { orderId, kind, actorType: "provider" as const, actorId: provider.id, at, details };
}

/**
 * Runs a status change, then logs it once the transaction has committed, so
 * the log never shows a change that rolled back (§11).
 */
async function changing<T extends ActionResult>(
  ctx: OrdersContext,
  body: (tx: Tx) => Promise<{ result: T; change?: { ref: string; from: string; to: string } }>,
): Promise<T> {
  const { result, change } = await ctx.db.transaction(body);
  if (change) logStatusChange({ ...change, actor: "provider" });
  return result;
}

// ---------------------------------------------------------------- startOrder

/** §8 startOrder: a draft for a patient, or a copy of a past order (Order again, D31). */
export async function startOrder(
  ctx: OrdersContext,
  provider: ProviderRef,
  input: { patientId: string } | { fromOrderRef: string },
): Promise<ActionResult<{ ref: string; leftOut: string[] }>> {
  return ctx.db.transaction(async (tx) => {
    const [store] = await tx.select({ n: count() }).from(storeItems).where(eq(storeItems.providerId, provider.id));
    if (store.n === 0) {
      return fail("STORE_EMPTY", "Your store is empty. Add items in My store before you start an order.");
    }

    let patientId: string;
    let source: { id: string; ref: string } | null = null;
    const lines: { catalogItemId: string; quantity: number; unitPriceCents: number }[] = [];
    const leftOut: string[] = [];

    if ("patientId" in input) {
      const [patient] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, input.patientId), eq(patients.practiceId, provider.practiceId)));
      if (!patient) return fail("PATIENT_NOT_IN_PRACTICE", "That patient isn't in your practice. Choose one from the list.");
      patientId = patient.id;
    } else {
      const [past] = await tx
        .select({ id: orders.id, ref: orders.ref, patientId: orders.patientId })
        .from(orders)
        .where(and(eq(orders.ref, input.fromOrderRef), eq(orders.providerId, provider.id)));
      if (!past) return NOT_FOUND();
      patientId = past.patientId;
      source = { id: past.id, ref: past.ref };
      // Same items, quantities and prices (F2), for the items still in My store.
      const pastLines = await tx
        .select({
          catalogItemId: orderLines.catalogItemId,
          quantity: orderLines.quantity,
          unitPriceCents: orderLines.unitPriceCents,
          name: catalogItems.name,
          active: catalogItems.active,
          inStore: storeItems.catalogItemId,
        })
        .from(orderLines)
        .innerJoin(catalogItems, eq(catalogItems.id, orderLines.catalogItemId))
        .leftJoin(
          storeItems,
          and(eq(storeItems.catalogItemId, orderLines.catalogItemId), eq(storeItems.providerId, provider.id)),
        )
        .where(eq(orderLines.orderId, past.id))
        .orderBy(asc(orderLines.id));
      for (const line of pastLines) {
        if (line.inStore && line.active) lines.push(line);
        else leftOut.push(line.name);
      }
    }

    const now = ctx.now();
    // A random ref can collide; ON CONFLICT keeps the transaction usable for another try.
    let order: { id: string; ref: string } | undefined;
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      [order] = await tx
        .insert(orders)
        .values({
          ref: newRef(),
          providerId: provider.id,
          practiceId: provider.practiceId,
          patientId,
          sourceOrderId: source?.id,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: orders.ref })
        .returning({ id: orders.id, ref: orders.ref });
    }
    if (!order) throw new Error("Couldn't find a free order ref in 5 tries");

    if (lines.length > 0) {
      await tx.insert(orderLines).values(lines.map((line) => ({ orderId: order.id, ...line })));
    }
    await tx
      .insert(orderEvents)
      .values(event(order.id, "created", provider, now, source ? { fromRef: source.ref, leftOut } : null));
    return { ok: true, ref: order.ref, leftOut };
  });
}

// ----------------------------------------------------------------- saveDraft

export type PriceRangeError = { code: ErrorCode; message: string; lowestPriceCents: number; msrpCents: number };

export type SavedLine = {
  catalogItemId: string;
  quantity: number;
  /** The price per bottle: as typed, or found from the typed margin (D5). */
  priceCents: number;
  /** The whole line: each part per bottle × quantity (D28). */
  split: Split;
  rangeError?: PriceRangeError;
};

type DraftLineInput = { catalogItemId: string; quantity: number; priceCents?: number; marginCents?: number };

/** §8 saveDraft (autosave): replaces the draft's lines. Out-of-range prices are saved too, and flagged (§4). */
export async function saveDraft(
  ctx: OrdersContext,
  provider: ProviderRef,
  input: { ref: string; lines: DraftLineInput[] },
): Promise<ActionResult<{ lines: SavedLine[]; totals: Split }>> {
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, provider, input.ref);
    if (!order) return NOT_FOUND();
    if (order.status !== "draft") {
      return fail("ORDER_NOT_DRAFT", "This order has been sent, so it can't be changed. Cancel it and use Order again.");
    }

    const ids = input.lines.map((line) => line.catalogItemId);
    const stocked =
      ids.length === 0
        ? []
        : await tx
            .select({ id: catalogItems.id, costCents: catalogItems.costCents, msrpCents: catalogItems.msrpCents })
            .from(storeItems)
            .innerJoin(catalogItems, eq(catalogItems.id, storeItems.catalogItemId))
            .where(
              and(eq(storeItems.providerId, provider.id), inArray(storeItems.catalogItemId, ids), eq(catalogItems.active, true)),
            );
    const product = new Map(stocked.map((row) => [row.id, row]));
    const missing = input.lines.findIndex((line) => !product.has(line.catalogItemId));
    if (missing >= 0) {
      return fail("ITEM_NOT_IN_STORE", "This item isn't in My store any more. Remove it from the order.", {
        field: `lines.${missing}.catalogItemId`,
      });
    }

    const saved: SavedLine[] = input.lines.map((line) => {
      const { costCents, msrpCents } = product.get(line.catalogItemId)!;
      const priceCents =
        line.priceCents ?? priceForMarginCents({ marginCents: line.marginCents!, costCents, feeRateBps: ctx.feeRateBps });
      const check = checkPrice({ priceCents, costCents, msrpCents, feeRateBps: ctx.feeRateBps });
      return {
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        priceCents,
        split: lineSplit({ priceCents, costCents, feeRateBps: ctx.feeRateBps, quantity: line.quantity }),
        ...(check.ok
          ? {}
          : {
              rangeError: {
                code: check.code,
                message: priceRangeMessage(check.code, check),
                lowestPriceCents: check.lowestPriceCents,
                msrpCents: check.msrpCents,
              },
            }),
      };
    });

    const now = ctx.now();
    const before = new Map(
      (
        await tx
          .select({ catalogItemId: orderLines.catalogItemId, unitPriceCents: orderLines.unitPriceCents })
          .from(orderLines)
          .where(eq(orderLines.orderId, order.id))
      ).map((line) => [line.catalogItemId, line.unitPriceCents]),
    );
    // The audit trail records price changes (PROBLEM_SPACE.md), not every keystroke's save.
    const changes = saved.filter((line) => before.has(line.catalogItemId) && before.get(line.catalogItemId) !== line.priceCents);
    if (changes.length > 0) {
      await tx.insert(orderEvents).values(
        changes.map((line) =>
          event(order.id, "price_changed", provider, now, {
            catalogItemId: line.catalogItemId,
            fromCents: before.get(line.catalogItemId),
            toCents: line.priceCents,
          }),
        ),
      );
    }

    // A draft's lines are never frozen, so replacing them is allowed (§7).
    await tx.delete(orderLines).where(eq(orderLines.orderId, order.id));
    if (saved.length > 0) {
      await tx.insert(orderLines).values(
        saved.map((line) => ({
          orderId: order.id,
          catalogItemId: line.catalogItemId,
          quantity: line.quantity,
          unitPriceCents: line.priceCents,
        })),
      );
    }
    await tx.update(orders).set({ updatedAt: now }).where(eq(orders.id, order.id));
    return { ok: true, lines: saved, totals: orderTotals(saved.map((line) => line.split)) };
  });
}

// ----------------------------------------------------------------- sendOrder

/**
 * §8 Send: checks every line against today's cost and retail price, freezes
 * the lines, sets the totals, the fee rate and link version 1, and records it,
 * in one transaction. A second Send of a sent order returns the same link, so
 * a double click gives one link (F2).
 */
export async function sendOrder(
  ctx: OrdersContext,
  provider: ProviderRef,
  ref: string,
): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  return changing<ActionResult<{ link: string; expiresAt: string }>>(ctx, async (tx) => {
    const order = await lockOrder(tx, provider, ref);
    if (!order) return { result: NOT_FOUND() };
    if (order.status === "sent") {
      return {
        result: {
          ok: true,
          link: payLink(ctx.appUrl, ctx.linkSigningKey, order.ref, order.linkVersion!),
          expiresAt: order.linkExpiresAt!.toISOString(),
        },
      };
    }
    if (order.status !== "draft") return { result: fail("ORDER_NOT_DRAFT", "This order has already been sent.") };

    const lines = await tx
      .select({
        id: orderLines.id,
        catalogItemId: orderLines.catalogItemId,
        quantity: orderLines.quantity,
        priceCents: orderLines.unitPriceCents,
        costCents: catalogItems.costCents,
        msrpCents: catalogItems.msrpCents,
        name: catalogItems.name,
        sizeLabel: catalogItems.sizeLabel,
        imagePath: catalogItems.imagePath,
        imageAlt: catalogItems.imageAlt,
        active: catalogItems.active,
        inStore: storeItems.catalogItemId,
      })
      .from(orderLines)
      .innerJoin(catalogItems, eq(catalogItems.id, orderLines.catalogItemId))
      .leftJoin(storeItems, and(eq(storeItems.catalogItemId, orderLines.catalogItemId), eq(storeItems.providerId, provider.id)))
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(orderLines.id));
    if (lines.length === 0) return { result: fail("ORDER_EMPTY", "Add at least one item before you send.") };

    const problems: LineError[] = [];
    for (const line of lines) {
      if (!line.inStore || !line.active) {
        problems.push({
          catalogItemId: line.catalogItemId,
          code: "ITEM_NOT_IN_STORE",
          message: `${line.name} isn't in My store any more. Remove it to send.`,
        });
        continue;
      }
      // Today's cost and retail price, not the ones the draft was started with (D27).
      const check = checkPrice({ ...line, feeRateBps: ctx.feeRateBps });
      if (!check.ok) {
        problems.push({ catalogItemId: line.catalogItemId, code: check.code, message: priceRangeMessage(check.code, check) });
      }
    }
    if (problems.length > 0) {
      return {
        result: fail("LINES_OUT_OF_RANGE", "Some prices are out of range. Fix the lines marked below, then send again.", {
          lines: problems,
        }),
      };
    }

    const now = ctx.now();
    const feeRateBps = ctx.feeRateBps;
    for (const line of lines) {
      const unit = unitSplit({ priceCents: line.priceCents, costCents: line.costCents, feeRateBps });
      await tx
        .update(orderLines)
        .set({
          frozenAt: now,
          unitCostCents: unit.costCents,
          feeRateBps,
          unitFeeCents: unit.feeCents,
          unitMarginCents: unit.marginCents,
          unitMsrpCents: line.msrpCents,
          productName: `${line.name}, ${line.sizeLabel}`,
          imagePath: line.imagePath,
          imageAlt: line.imageAlt,
        })
        .where(eq(orderLines.id, line.id));
    }
    const totals = orderTotals(lines.map((line) => lineSplit({ ...line, feeRateBps })));
    const expiresAt = new Date(now.getTime() + ctx.linkTtlDays * DAY_MS);
    const sent = await tx
      .update(orders)
      .set({
        status: "sent",
        sentAt: now,
        feeRateBps,
        linkVersion: 1,
        linkExpiresAt: expiresAt,
        totalCents: totals.priceCents,
        costCents: totals.costCents,
        feeCents: totals.feeCents,
        marginCents: totals.marginCents,
        updatedAt: now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.status, "draft")))
      .returning({ id: orders.id });
    if (sent.length !== 1) throw new Error(`Send changed ${sent.length} orders`);

    const link = payLink(ctx.appUrl, ctx.linkSigningKey, order.ref, 1);
    await tx.insert(orderEvents).values(event(order.id, "sent", provider, now, { totalCents: totals.priceCents }));
    await ctx.linkSender.send(tx, { orderId: order.id, ref: order.ref, patientId: order.patientId, link, at: now });
    await notifyStatusChange(tx, order.ref);
    return {
      result: { ok: true, link, expiresAt: expiresAt.toISOString() },
      change: { ref: order.ref, from: "draft", to: "sent" },
    };
  });
}

// ------------------------------------------------------------------- newLink

/** §8 New link: raises the link version, which turns every older link off, and restarts the 30 days. */
export async function newLink(
  ctx: OrdersContext,
  provider: ProviderRef,
  ref: string,
): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  return ctx.db.transaction(async (tx) => {
    const order = await lockOrder(tx, provider, ref);
    if (!order) return NOT_FOUND();
    if (order.status === "needs_review") return PAYMENT_IN_PROGRESS();
    if (order.status !== "sent") return fail("ORDER_NOT_SENT", "Only a sent order has a link to replace.");
    if (await hasPendingAttempt(tx, order.id)) return PAYMENT_IN_PROGRESS();

    const now = ctx.now();
    const version = order.linkVersion! + 1;
    const expiresAt = new Date(now.getTime() + ctx.linkTtlDays * DAY_MS);
    await tx
      .update(orders)
      .set({ linkVersion: version, linkExpiresAt: expiresAt, updatedAt: now })
      .where(eq(orders.id, order.id));
    const link = payLink(ctx.appUrl, ctx.linkSigningKey, order.ref, version);
    await tx.insert(orderEvents).values(event(order.id, "new_link", provider, now, { linkVersion: version }));
    await ctx.linkSender.send(tx, { orderId: order.id, ref: order.ref, patientId: order.patientId, link, at: now });
    // An open pay page holding the old link hears this and rechecks it.
    await notifyStatusChange(tx, order.ref);
    return { ok: true, link, expiresAt: expiresAt.toISOString() };
  });
}

// --------------------------------------------------------------- cancelOrder

/** §8 Cancel order and Discard draft. Both wait while a payment is in progress (D26). */
export async function cancelOrder(
  ctx: OrdersContext,
  provider: ProviderRef,
  ref: string,
): Promise<ActionResult<{ status: "cancelled" }>> {
  return changing<ActionResult<{ status: "cancelled" }>>(ctx, async (tx) => {
    const order = await lockOrder(tx, provider, ref);
    if (!order) return { result: NOT_FOUND() };
    if (order.status === "paid") return { result: fail("ORDER_FINAL", "This order is paid, so it can't be cancelled.") };
    if (order.status === "cancelled") return { result: fail("ORDER_FINAL", "This order is already cancelled.") };
    if (order.status === "needs_review" || (await hasPendingAttempt(tx, order.id))) {
      return { result: PAYMENT_IN_PROGRESS() };
    }

    const now = ctx.now();
    await tx
      .update(orders)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(and(eq(orders.id, order.id), eq(orders.status, order.status)));
    const kind = order.status === "draft" ? "draft_discarded" : "cancelled";
    await tx.insert(orderEvents).values(event(order.id, kind, provider, now));
    await notifyStatusChange(tx, order.ref);
    return {
      result: { ok: true, status: "cancelled" as const },
      change: { ref: order.ref, from: order.status, to: "cancelled" },
    };
  });
}

// ------------------------------------------------------------------- reading

export type OrderLineView = {
  catalogItemId: string;
  brand: string;
  name: string;
  sizeLabel: string;
  imagePath: string;
  imageAlt: string;
  quantity: number;
  /** Per bottle. A draft's cost, retail and lowest price are today's; a sent line's are frozen. */
  priceCents: number;
  costCents: number;
  msrpCents: number;
  lowestPriceCents: number;
  unitSplit: Split;
  split: Split;
  rangeError?: PriceRangeError;
};

export type OrderView = {
  ref: string;
  status: OrderStatus;
  display: DisplayStatus;
  actions: SalesAction[];
  paymentInProgress: boolean;
  patient: { id: string; name: string };
  createdAt: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  linkExpiresAt: Date | null;
  /** The current pay link, once sent. Copy link works at any time (§6). */
  link: string | null;
  feeRateBps: number;
  lines: OrderLineView[];
  totals: Split;
  sourceOrderRef: string | null;
  /** Items Order again couldn't copy, because they've left My store. */
  leftOut: string[];
};

/** One of the provider's orders, or null (§8 Order details; the editor reads it too). */
export async function getOrder(ctx: OrdersContext, provider: ProviderRef, ref: string): Promise<OrderView | null> {
  const db = ctx.db;
  const [order] = await db
    .select({ order: orders, firstName: patients.firstName, lastName: patients.lastName })
    .from(orders)
    .innerJoin(patients, eq(patients.id, orders.patientId))
    .where(and(eq(orders.ref, ref), eq(orders.providerId, provider.id)));
  if (!order) return null;
  const o = order.order;
  const paymentInProgress = await hasPendingAttempt(db, o.id);
  const feeRateBps = o.feeRateBps ?? ctx.feeRateBps;

  const rows = await db
    .select({ line: orderLines, product: catalogItems })
    .from(orderLines)
    .innerJoin(catalogItems, eq(catalogItems.id, orderLines.catalogItemId))
    .where(eq(orderLines.orderId, o.id))
    .orderBy(asc(orderLines.id));
  const lines: OrderLineView[] = rows.map(({ line, product }) => {
    const frozen = line.frozenAt !== null;
    const costCents = frozen ? line.unitCostCents! : product.costCents;
    const msrpCents = frozen ? line.unitMsrpCents! : product.msrpCents;
    const unit: Split = frozen
      ? { priceCents: line.unitPriceCents, costCents, feeCents: line.unitFeeCents!, marginCents: line.unitMarginCents! }
      : unitSplit({ priceCents: line.unitPriceCents, costCents, feeRateBps });
    const check = checkPrice({ priceCents: line.unitPriceCents, costCents, msrpCents, feeRateBps });
    return {
      catalogItemId: line.catalogItemId,
      brand: product.brand,
      name: product.name,
      sizeLabel: product.sizeLabel,
      imagePath: frozen ? line.imagePath! : product.imagePath,
      imageAlt: frozen ? line.imageAlt! : product.imageAlt,
      quantity: line.quantity,
      priceCents: line.unitPriceCents,
      costCents,
      msrpCents,
      lowestPriceCents: lowestPriceCents({ costCents, feeRateBps }),
      unitSplit: unit,
      split: {
        priceCents: unit.priceCents * line.quantity,
        costCents: unit.costCents * line.quantity,
        feeCents: unit.feeCents * line.quantity,
        marginCents: unit.marginCents * line.quantity,
      },
      ...(frozen || check.ok
        ? {}
        : {
            rangeError: {
              code: check.code,
              message: priceRangeMessage(check.code, check),
              lowestPriceCents: check.lowestPriceCents,
              msrpCents: check.msrpCents,
            },
          }),
    };
  });

  const totals: Split =
    o.totalCents === null
      ? orderTotals(lines.map((line) => line.split))
      : { priceCents: o.totalCents, costCents: o.costCents!, feeCents: o.feeCents!, marginCents: o.marginCents! };

  const [created] = await db
    .select({ details: orderEvents.details })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.kind, "created")))
    .limit(1);
  const origin = (created?.details ?? null) as { fromRef?: string; leftOut?: string[] } | null;

  const state = { status: o.status, linkExpiresAt: o.linkExpiresAt, paymentInProgress };
  const now = ctx.now();
  return {
    ref: o.ref,
    status: o.status,
    display: displayStatus(state, now),
    actions: salesActions(state, now),
    paymentInProgress,
    patient: { id: o.patientId, name: `${order.firstName} ${order.lastName}` },
    createdAt: o.createdAt,
    sentAt: o.sentAt,
    paidAt: o.paidAt,
    cancelledAt: o.cancelledAt,
    linkExpiresAt: o.linkExpiresAt,
    link:
      o.linkVersion === null || o.status === "cancelled"
        ? null
        : payLink(ctx.appUrl, ctx.linkSigningKey, o.ref, o.linkVersion),
    feeRateBps,
    lines,
    totals,
    sourceOrderRef: origin?.fromRef ?? null,
    leftOut: origin?.leftOut ?? [],
  };
}

export type RecentOrder = {
  ref: string;
  createdAt: Date;
  display: DisplayStatus;
  totalCents: number | null;
  itemCount: number;
};

/** A patient's recent orders from this provider, newest first, for Order again (F2 step 1). Drafts are left out. */
export async function recentOrders(ctx: OrdersContext, provider: ProviderRef, patientId: string): Promise<RecentOrder[]> {
  const rows = await ctx.db
    .select({
      ref: orders.ref,
      createdAt: orders.createdAt,
      status: orders.status,
      linkExpiresAt: orders.linkExpiresAt,
      totalCents: orders.totalCents,
      itemCount: count(orderLines.id),
    })
    .from(orders)
    .leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(and(eq(orders.providerId, provider.id), eq(orders.patientId, patientId), ne(orders.status, "draft")))
    .groupBy(orders.id)
    .orderBy(desc(orders.createdAt))
    .limit(5);
  const now = ctx.now();
  return rows.map((row) => ({
    ref: row.ref,
    createdAt: row.createdAt,
    display: displayStatus({ status: row.status, linkExpiresAt: row.linkExpiresAt, paymentInProgress: false }, now),
    totalCents: row.totalCents,
    itemCount: row.itemCount,
  }));
}

/**
 * The patients this provider last started orders for, newest first, each once (F2 step 1).
 * New order lists them before any typing; search still covers the whole practice.
 */
export async function recentPatients(ctx: OrdersContext, provider: ProviderRef, limit = 10): Promise<PatientMatch[]> {
  const rows = await ctx.db
    .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
    .from(orders)
    .innerJoin(patients, eq(patients.id, orders.patientId))
    .where(eq(orders.providerId, provider.id))
    .groupBy(patients.id)
    .orderBy(desc(max(orders.createdAt)))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
}
