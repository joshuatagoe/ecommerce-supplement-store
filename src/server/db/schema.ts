// The data model of ARCHITECTURE.md §7, with every database rule that can be
// written as a constraint. The three rules that need triggers (frozen lines,
// totals after Send, the append-only audit trail) are in the custom migration
// drizzle/0002_money_core_triggers.sql. Constraint names say which rule
// refused a write, so Orders and the tests can tell them apart.
//
// Money is integer cents and never negative. Every timestamp is timestamptz.
// IDs are uuidv7(), built into Postgres 18 (D45).
import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const at = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => integer(name);

// One CHECK per money column, named <table>_<column>_not_negative.
function notNegative(table: string, columns: AnyPgColumn[]) {
  return columns.map((column) => check(`${table}_${column.name}_not_negative`, sql`${column} >= 0`));
}

// a ⇒ b. A CHECK that comes out NULL lets the row through, so each side is
// either an IS [NOT] NULL test or only reads columns another rule requires.
const implies = (a: SQL, b: SQL) => sql`NOT (${a}) OR (${b})`;

export const practices = pgTable("practices", {
  id: id(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(), // IANA, e.g. America/Los_Angeles (D29)
});

export const providers = pgTable("providers", {
  id: id(),
  practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),
  displayName: text("display_name").notNull(),
});

// Seeded, standing in for the EHR. Minimal, and never logged (§10).
export const patients = pgTable("patients", {
  id: id(),
  practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
});

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: id(),
    brand: text("brand").notNull(),
    name: text("name").notNull(),
    sizeLabel: text("size_label").notNull(),
    imagePath: text("image_path").notNull(),
    imageAlt: text("image_alt").notNull(),
    costCents: cents("cost_cents").notNull(),
    msrpCents: cents("msrp_cents").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => notNegative("catalog_items", [t.costCents, t.msrpCents]),
);

export const storeItems = pgTable(
  "store_items",
  {
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    usualPriceCents: cents("usual_price_cents").notNull(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "store_items_pkey", columns: [t.providerId, t.catalogItemId] }),
    ...notNegative("store_items", [t.usualPriceCents]),
  ],
);

export const ORDER_STATUSES = ["draft", "sent", "needs_review", "paid", "cancelled"] as const;
export const ATTEMPT_STATUSES = ["pending", "succeeded", "declined", "failed"] as const;
export const SETTLED_BY = ["request", "sweep"] as const;
export const ACTOR_TYPES = ["provider", "patient", "sweep", "system"] as const;

const oneOf = (words: readonly string[]) => sql.raw(words.map((word) => `'${word}'`).join(", "));

export const orders = pgTable(
  "orders",
  {
    id: id(),
    ref: text("ref").notNull(), // K7Q2-M9XD, made by Orders (§6)
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    sourceOrderId: uuid("source_order_id").references((): AnyPgColumn => orders.id), // Order again
    status: text("status", { enum: ORDER_STATUSES }).notNull(),
    // Set by Send (§8), so NULL on a draft.
    linkVersion: integer("link_version"),
    linkExpiresAt: at("link_expires_at"),
    feeRateBps: integer("fee_rate_bps"),
    totalCents: cents("total_cents"),
    costCents: cents("cost_cents"),
    feeCents: cents("fee_cents"),
    marginCents: cents("margin_cents"),
    paidAttemptId: uuid("paid_attempt_id"),
    createdAt: at("created_at").notNull().defaultNow(),
    sentAt: at("sent_at"),
    paidAt: at("paid_at"),
    cancelledAt: at("cancelled_at"),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("orders_ref_unique").on(t.ref),
    check("orders_status_known", sql`${t.status} IN (${oneOf(ORDER_STATUSES)})`),
    ...notNegative("orders", [t.totalCents, t.costCents, t.feeCents, t.marginCents]),
    check("orders_fee_rate_bps_range", sql`${t.feeRateBps} BETWEEN 0 AND 10000`),
    check("orders_link_version_positive", sql`${t.linkVersion} >= 1`),
    // Order totals add up (§7). orders_send_fields_set makes sure a sent order has them.
    check("orders_totals_add_up", sql`${t.costCents} + ${t.feeCents} + ${t.marginCents} = ${t.totalCents}`),
    // Status and timestamps agree (§7).
    check(
      "orders_sent_has_sent_at",
      implies(sql`${t.status} IN ('sent', 'needs_review', 'paid')`, sql`${t.sentAt} IS NOT NULL`),
    ),
    check("orders_draft_not_sent", implies(sql`${t.status} = 'draft'`, sql`${t.sentAt} IS NULL`)),
    check(
      "orders_send_fields_set",
      implies(
        sql`${t.sentAt} IS NOT NULL`,
        sql`num_nulls(${t.feeRateBps}, ${t.linkVersion}, ${t.linkExpiresAt}, ${t.totalCents}, ${t.costCents}, ${t.feeCents}, ${t.marginCents}) = 0`,
      ),
    ),
    check("orders_cancelled_has_cancelled_at", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`),
    // Paid means a real payment (§7): paid exactly when there is a paid attempt
    // and a paid time, and that attempt belongs to this order.
    check(
      "orders_paid_has_payment",
      sql`(${t.status} = 'paid') = (${t.paidAttemptId} IS NOT NULL) AND (${t.status} = 'paid') = (${t.paidAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "orders_paid_attempt_fk",
      columns: [t.id, t.paidAttemptId],
      foreignColumns: [paymentAttempts.orderId, paymentAttempts.id],
    }),
    // Sales lists and monthly totals (§7 Indexes).
    index("orders_provider_created_idx").on(t.providerId, t.createdAt.desc().nullsFirst()),
    index("orders_provider_sent_idx").on(t.providerId, t.sentAt.desc().nullsFirst()),
    index("orders_provider_paid_idx").on(t.providerId, t.paidAt.desc().nullsFirst()),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    quantity: integer("quantity").notNull(),
    unitPriceCents: cents("unit_price_cents").notNull(),
    // Frozen at Send (D27), so NULL on a draft line.
    frozenAt: at("frozen_at"),
    unitCostCents: cents("unit_cost_cents"),
    feeRateBps: integer("fee_rate_bps"),
    unitFeeCents: cents("unit_fee_cents"),
    unitMarginCents: cents("unit_margin_cents"),
    unitMsrpCents: cents("unit_msrp_cents"),
    productName: text("product_name"),
    imagePath: text("image_path"),
    imageAlt: text("image_alt"),
  },
  (t) => {
    const frozen = sql`${t.frozenAt} IS NOT NULL`;
    return [
      unique("order_lines_one_per_product").on(t.orderId, t.catalogItemId),
      check("order_lines_quantity_range", sql`${t.quantity} BETWEEN 1 AND 10`),
      ...notNegative("order_lines", [t.unitPriceCents, t.unitCostCents, t.unitFeeCents, t.unitMarginCents, t.unitMsrpCents]),
      check("order_lines_fee_rate_bps_range", sql`${t.feeRateBps} BETWEEN 0 AND 10000`),
      // Without this, a frozen line missing a column would pass the checks
      // below, because a comparison with NULL never fails a CHECK.
      check(
        "order_lines_frozen_complete",
        implies(
          frozen,
          sql`num_nulls(${t.unitCostCents}, ${t.feeRateBps}, ${t.unitFeeCents}, ${t.unitMarginCents}, ${t.unitMsrpCents}, ${t.productName}, ${t.imagePath}, ${t.imageAlt}) = 0`,
        ),
      ),
      check(
        "order_lines_frozen_adds_up",
        implies(frozen, sql`${t.unitCostCents} + ${t.unitFeeCents} + ${t.unitMarginCents} = ${t.unitPriceCents}`),
      ),
      // ceil(price × rate ÷ 10,000) in integers (D17), as bigint so it can't overflow.
      check(
        "order_lines_frozen_fee_right",
        implies(frozen, sql`${t.unitFeeCents} = (${t.unitPriceCents}::bigint * ${t.feeRateBps} + 9999) / 10000`),
      ),
      check(
        "order_lines_frozen_in_range",
        implies(frozen, sql`${t.unitMarginCents} >= 0 AND ${t.unitPriceCents} <= ${t.unitMsrpCents}`),
      ),
    ];
  },
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(), // also the payment company's idempotency key (§5)
    orderId: uuid("order_id")
      .notNull()
      .references((): AnyPgColumn => orders.id),
    idempotencyKey: text("idempotency_key").notNull(), // the page's Pay key
    amountCents: cents("amount_cents").notNull(),
    status: text("status", { enum: ATTEMPT_STATUSES }).notNull(),
    chargeRef: text("charge_ref"),
    settledBy: text("settled_by", { enum: SETTLED_BY }),
    createdAt: at("created_at").notNull().defaultNow(),
    settledAt: at("settled_at"),
  },
  (t) => [
    // The target of orders_paid_attempt_fk.
    unique("payment_attempts_order_id_id_unique").on(t.orderId, t.id),
    ...notNegative("payment_attempts", [t.amountCents]),
    check("payment_attempts_status_known", sql`${t.status} IN (${oneOf(ATTEMPT_STATUSES)})`),
    check("payment_attempts_settled_by_known", sql`${t.settledBy} IN (${oneOf(SETTLED_BY)})`),
    check("payment_attempts_success_has_charge_ref", implies(sql`${t.status} = 'succeeded'`, sql`${t.chargeRef} IS NOT NULL`)),
    // The three guards against a double charge (§5).
    uniqueIndex("payment_attempts_pay_key_once").on(t.idempotencyKey),
    uniqueIndex("one_live_attempt_per_order").on(t.orderId).where(sql`${t.status} IN ('pending', 'succeeded')`),
    // The sweep's work list.
    index("payment_attempts_pending_created_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: text("kind").notNull(),
    actorType: text("actor_type", { enum: ACTOR_TYPES }).notNull(),
    actorId: uuid("actor_id"),
    at: at("at").notNull().defaultNow(),
    details: jsonb("details"), // never patient data (§7)
  },
  (t) => [
    check("order_events_actor_type_known", sql`${t.actorType} IN (${oneOf(ACTOR_TYPES)})`),
    check(
      "order_events_system_has_no_actor",
      implies(sql`${t.actorType} IN ('sweep', 'system')`, sql`${t.actorId} IS NULL`),
    ),
    // Order details reads one order's trail in time order.
    index("order_events_order_at_idx").on(t.orderId, t.at),
  ],
);
