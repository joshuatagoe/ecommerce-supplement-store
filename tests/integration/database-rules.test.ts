// Each rule in ARCHITECTURE.md §7 "Database rules", shown refusing bad data on
// the real Postgres schema. Each test also shows the good version accepted, so
// a refusal can't come from a broken fixture, and checks which rule refused.
import { afterAll, describe, expect, it } from "vitest";
import {
  accepted,
  catalogItem,
  type Clinic,
  type Db,
  deleteFrom,
  draftLine,
  draftOrder,
  expectRefused,
  frozenLine,
  insertInto,
  outcome,
  payAttempt,
  type Row,
  rolledBack,
  seedClinic,
  seedSentOrder,
  sendColumns,
  sentOrder,
  succeededAttempt,
  testPool,
  update,
} from "./fixtures";

const pool = testPool();
afterAll(() => pool.end());

function withClinic(body: (db: Db, clinic: Clinic) => Promise<void>): () => Promise<void> {
  return () => rolledBack(pool, async (db) => body(db, await seedClinic(db)));
}

async function insertDraft(db: Db, clinic: Clinic, overrides: Row = {}): Promise<Row> {
  return accepted(db, insertInto("orders", draftOrder(clinic, overrides)));
}

/** A sent order with no lines yet, for tests that write their own frozen line. */
async function insertSent(db: Db, clinic: Clinic, overrides: Row = {}): Promise<Row> {
  return accepted(db, insertInto("orders", sentOrder(clinic, overrides)));
}

/** Expects the database to accept the statement, then undoes it. */
async function expectAccepted(db: Db, statement: { text: string; values: unknown[] }): Promise<void> {
  const error = await outcome(db, statement);
  expect(error?.message).toBeUndefined();
}

describe("column details (D45)", () => {
  it(
    "fills ids with uuidv7() and timestamps with now()",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      expect(order.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const { rows } = await db.query("SELECT now() AS now");
      expect(order.created_at).toEqual(rows[0].now);
      expect(order.updated_at).toEqual(rows[0].now);
      const event = await accepted(
        db,
        insertInto("order_events", {
          order_id: order.id,
          kind: "draft started",
          actor_type: "provider",
          actor_id: clinic.providerId,
        }),
      );
      expect(event.at).toEqual(rows[0].now);
      const item = await accepted(
        db,
        insertInto("store_items", { provider_id: clinic.providerId, catalog_item_id: clinic.magnesiumId, usual_price_cents: 3600 }),
      );
      expect(item.updated_at).toEqual(rows[0].now);
    }),
  );

  it(
    "accepts a draft with only ref, provider, practice, patient and status, leaving Send's columns empty",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      for (const column of [...Object.keys(sendColumns()), "paid_attempt_id", "paid_at", "cancelled_at", "source_order_id"]) {
        expect(order[column], column).toBeNull();
      }
    }),
  );

  it(
    "accepts a draft line with only order, item, quantity and price, leaving its frozen columns empty",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      const line = await accepted(db, insertInto("order_lines", draftLine(order.id, clinic.magnesiumId)));
      const frozenOnly = Object.keys(frozenLine(order.id, clinic.magnesiumId)).filter(
        (column) => !(column in draftLine(order.id, clinic.magnesiumId)),
      );
      expect(frozenOnly).toHaveLength(9);
      for (const column of frozenOnly) expect(line[column], column).toBeNull();
    }),
  );

  it(
    "keys store_items by provider and catalog item, with no id of its own",
    withClinic(async (db, clinic) => {
      const item = { provider_id: clinic.providerId, catalog_item_id: clinic.magnesiumId, usual_price_cents: 3600 };
      const row = await accepted(db, insertInto("store_items", item));
      expect(row).not.toHaveProperty("id");
      await expectRefused(db, insertInto("store_items", { ...item, usual_price_cents: 3500 }), "store_items_pkey");
    }),
  );

  it(
    "starts link versions at 1, which New link only raises (§6)",
    withClinic(async (db, clinic) => {
      await expectAccepted(db, insertInto("orders", sentOrder(clinic, { link_version: 1 })));
      await expectRefused(
        db,
        insertInto("orders", sentOrder(clinic, { link_version: 0 })),
        "orders_link_version_positive",
      );
    }),
  );

  it(
    "keeps order refs unique",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      await expectRefused(db, insertInto("orders", draftOrder(clinic, { ref: order.ref })), "orders_ref_unique");
    }),
  );

  it(
    "links Order again to a real earlier order",
    withClinic(async (db, clinic) => {
      const first = await seedSentOrder(db, clinic);
      await expectAccepted(db, insertInto("orders", draftOrder(clinic, { source_order_id: first.id })));
      await expectRefused(
        db,
        insertInto("orders", draftOrder(clinic, { source_order_id: "01900000-0000-7000-8000-000000000000" })),
        "orders_source_order_id_orders_id_fk",
      );
    }),
  );
});

describe("money is whole cents and never negative", () => {
  // Every money column, on a row where no other rule reads it.
  const columns: [table: string, column: string, row: (db: Db, clinic: Clinic) => Promise<Row>][] = [
    ["catalog_items", "cost_cents", async () => catalogItem()],
    ["catalog_items", "msrp_cents", async () => catalogItem()],
    ["store_items", "usual_price_cents", async (_db, c) => ({ provider_id: c.providerId, catalog_item_id: c.magnesiumId })],
    ["orders", "total_cents", async (_db, c) => draftOrder(c)],
    ["orders", "cost_cents", async (_db, c) => draftOrder(c)],
    ["orders", "fee_cents", async (_db, c) => draftOrder(c)],
    ["orders", "margin_cents", async (_db, c) => draftOrder(c)],
    ...["unit_price_cents", "unit_cost_cents", "unit_fee_cents", "unit_margin_cents", "unit_msrp_cents"].map(
      (column): [string, string, (db: Db, clinic: Clinic) => Promise<Row>] => [
        "order_lines",
        column,
        async (db, c) => draftLine((await insertDraft(db, c)).id, c.magnesiumId),
      ],
    ),
    ["payment_attempts", "amount_cents", async (db, c) => payAttempt((await insertSent(db, c)).id)],
  ];

  it.each(columns)("%s.%s accepts 0¢ and refuses -1¢ and 12.5¢", (table, column, row) =>
    withClinic(async (db, clinic) => {
      const good = await row(db, clinic);
      await expectAccepted(db, insertInto(table, { ...good, [column]: 0 }));
      await expectRefused(db, insertInto(table, { ...good, [column]: -1 }), `${table}_${column}_not_negative`);
      // A fraction never reaches the CHECK: the integer column itself refuses it.
      const fraction = await outcome(db, insertInto(table, { ...good, [column]: 12.5 }));
      expect(fraction?.code).toBe("22P02");
    })(),
  );

  it(
    "keeps fee rates within 0–10,000 bps",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      for (const [table, row] of [
        ["orders", sentOrder(clinic)],
        ["order_lines", draftLine(order.id, clinic.magnesiumId)],
      ] as const) {
        await expectAccepted(db, insertInto(table, { ...row, fee_rate_bps: 10_000 }));
        await expectRefused(db, insertInto(table, { ...row, fee_rate_bps: 10_001 }), `${table}_fee_rate_bps_range`);
        await expectRefused(db, insertInto(table, { ...row, fee_rate_bps: -1 }), `${table}_fee_rate_bps_range`);
      }
    }),
  );
});

describe("a frozen line adds up", () => {
  it(
    "refuses cost + fee + margin that isn't the price",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      await expectAccepted(db, insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId)));
      await expectRefused(
        db,
        insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, { unit_margin_cents: 1572 })),
        "order_lines_frozen_adds_up",
      );
    }),
  );

  it(
    "leaves a draft line's unfrozen columns alone",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      await expectAccepted(
        db,
        insertInto(
          "order_lines",
          draftLine(order.id, clinic.magnesiumId, { unit_cost_cents: 1, unit_fee_cents: 1, unit_margin_cents: 1 }),
        ),
      );
    }),
  );

  it.each([
    "unit_cost_cents",
    "fee_rate_bps",
    "unit_fee_cents",
    "unit_margin_cents",
    "unit_msrp_cents",
    "product_name",
    "image_path",
    "image_alt",
  ])("refuses a frozen line with no %s, which would let the sums pass unchecked", (column) =>
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      await expectRefused(
        db,
        insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, { [column]: null })),
        "order_lines_frozen_complete",
      );
    })(),
  );
});

describe("a frozen line's fee is right", () => {
  // $38.00 at 75 bps owes 28.5¢, so the fee is 29¢ (D17).
  const at3800 = { unit_price_cents: 3800, unit_cost_cents: 2000 };

  it(
    "refuses a fee rounded down or overcharged, even when the parts add up",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      const line = (fee: number) =>
        frozenLine(order.id, clinic.magnesiumId, { ...at3800, unit_fee_cents: fee, unit_margin_cents: 3800 - 2000 - fee });
      await expectAccepted(db, insertInto("order_lines", line(29)));
      await expectRefused(db, insertInto("order_lines", line(28)), "order_lines_frozen_fee_right");
      await expectRefused(db, insertInto("order_lines", line(30)), "order_lines_frozen_fee_right");
    }),
  );

  it(
    "computes the fee without overflowing on large prices",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      // $20M × 10,000 bps is past the 32-bit integer range mid-calculation.
      const price = 2_000_000_000;
      await expectAccepted(
        db,
        insertInto(
          "order_lines",
          frozenLine(order.id, clinic.magnesiumId, {
            unit_price_cents: price,
            unit_cost_cents: 0,
            fee_rate_bps: 10_000,
            unit_fee_cents: price,
            unit_margin_cents: 0,
            unit_msrp_cents: price,
          }),
        ),
      );
    }),
  );
});

describe("a frozen line is in range", () => {
  // Cost $20.00 at 75 bps: the lowest price is $20.16 (D17), MSRP is $40.00 (D14).
  const priced = (price: number, fee: number) => ({
    unit_price_cents: price,
    unit_fee_cents: fee,
    unit_margin_cents: price - 2000 - fee,
  });

  it(
    "accepts the lowest price and MSRP",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      await expectAccepted(db, insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, priced(2016, 16))));
      await expectAccepted(db, insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, priced(4000, 30))));
    }),
  );

  it(
    "refuses 1¢ above MSRP",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      await expectRefused(
        db,
        insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, priced(4001, 31))),
        "order_lines_frozen_in_range",
      );
    }),
  );

  it(
    "refuses 1¢ below the lowest price, where the margin is -1¢",
    withClinic(async (db, clinic) => {
      const order = await insertSent(db, clinic);
      await expectRefused(
        db,
        insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId, priced(2015, 16))),
        "order_lines_frozen_in_range",
        "order_lines_unit_margin_cents_not_negative",
      );
    }),
  );
});

describe("a frozen line never changes", () => {
  it(
    "refuses any update or delete once frozen",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const where = { order_id: order.id };
      for (const set of [
        { quantity: 2 },
        { unit_price_cents: 3700, unit_fee_cents: 28, unit_margin_cents: 1672 },
        { product_name: "Renamed" },
        { frozen_at: null },
      ]) {
        await expectRefused(db, update("order_lines", where, set), "order_lines_frozen_never_change");
      }
      await expectRefused(db, deleteFrom("order_lines", where), "order_lines_frozen_never_change");
    }),
  );

  it(
    "lets a draft line change, be deleted, and be frozen",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      const line = await accepted(db, insertInto("order_lines", draftLine(order.id, clinic.magnesiumId)));
      await expectAccepted(db, update("order_lines", { id: line.id }, { quantity: 2 }));
      await expectAccepted(db, deleteFrom("order_lines", { id: line.id }));
      // Send freezes a line by filling its frozen columns in one update.
      await accepted(db, update("order_lines", { id: line.id }, frozenLine(order.id, clinic.magnesiumId)));
      await expectRefused(db, update("order_lines", { id: line.id }, { quantity: 3 }), "order_lines_frozen_never_change");
    }),
  );
});

describe("order totals add up and never change after Send", () => {
  it(
    "refuses totals whose cost, fee and margin aren't the total",
    withClinic(async (db, clinic) => {
      await expectAccepted(db, insertInto("orders", sentOrder(clinic)));
      await expectRefused(db, insertInto("orders", sentOrder(clinic, { margin_cents: 1572 })), "orders_totals_add_up");
    }),
  );

  it(
    "refuses changing the totals or fee rate of a sent order, even to totals that add up",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const where = { id: order.id };
      await expectRefused(db, update("orders", where, { total_cents: 3601, margin_cents: 1574 }), "orders_totals_frozen");
      await expectRefused(db, update("orders", where, { fee_rate_bps: 80 }), "orders_totals_frozen");
      // The rest of a sent order can still change, for New link and Cancel order.
      await expectAccepted(db, update("orders", where, { link_version: 2 }));
      await expectAccepted(db, update("orders", where, { status: "cancelled", cancelled_at: new Date() }));
    }),
  );

  it(
    "lets Send set the totals on a draft",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      await expectAccepted(db, update("orders", { id: order.id }, { status: "sent", ...sendColumns() }));
    }),
  );
});

describe("one live attempt per order", () => {
  it(
    "refuses a second pending or succeeded attempt while one is pending",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const first = await accepted(db, insertInto("payment_attempts", payAttempt(order.id)));
      await expectRefused(db, insertInto("payment_attempts", payAttempt(order.id)), "one_live_attempt_per_order");
      await expectRefused(db, insertInto("payment_attempts", succeededAttempt(order.id)), "one_live_attempt_per_order");
      // Finished attempts don't count, and other orders aren't affected.
      await accepted(db, insertInto("payment_attempts", payAttempt(order.id, { status: "declined" })));
      await accepted(db, insertInto("payment_attempts", payAttempt(order.id, { status: "failed" })));
      const other = await seedSentOrder(db, clinic);
      await expectAccepted(db, insertInto("payment_attempts", payAttempt(other.id)));
      // Once the first one fails, a new attempt may start.
      await accepted(db, update("payment_attempts", { id: first.id }, { status: "failed", settled_by: "sweep", settled_at: new Date() }));
      await expectAccepted(db, insertInto("payment_attempts", payAttempt(order.id)));
    }),
  );

  it(
    "refuses a second success, and turning a finished attempt back into a live one",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      await accepted(db, insertInto("payment_attempts", succeededAttempt(order.id)));
      await expectRefused(db, insertInto("payment_attempts", succeededAttempt(order.id)), "one_live_attempt_per_order");
      const declined = await accepted(db, insertInto("payment_attempts", payAttempt(order.id, { status: "declined" })));
      await expectRefused(
        db,
        update("payment_attempts", { id: declined.id }, { status: "pending" }),
        "one_live_attempt_per_order",
      );
    }),
  );
});

describe("each Pay key is used once", () => {
  it(
    "refuses a repeated Pay key, even on another order",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const other = await seedSentOrder(db, clinic);
      const first = await accepted(db, insertInto("payment_attempts", payAttempt(order.id)));
      await expectAccepted(db, insertInto("payment_attempts", payAttempt(other.id)));
      await expectRefused(
        db,
        insertInto("payment_attempts", payAttempt(other.id, { idempotency_key: first.idempotency_key })),
        "payment_attempts_pay_key_once",
      );
    }),
  );
});

describe("paid means a real payment", () => {
  async function sentWithSuccess(db: Db, clinic: Clinic) {
    const order = await seedSentOrder(db, clinic);
    const attempt = await accepted(db, insertInto("payment_attempts", succeededAttempt(order.id)));
    return { order, attempt, where: { id: order.id } };
  }

  it(
    "accepts paid with this order's attempt and a paid time",
    withClinic(async (db, clinic) => {
      const { attempt, where } = await sentWithSuccess(db, clinic);
      await expectAccepted(db, update("orders", where, { status: "paid", paid_at: new Date(), paid_attempt_id: attempt.id }));
    }),
  );

  it(
    "refuses paid without an attempt or without a paid time, and an attempt or paid time on an unpaid order",
    withClinic(async (db, clinic) => {
      const { attempt, where } = await sentWithSuccess(db, clinic);
      const rule = "orders_paid_has_payment";
      await expectRefused(db, update("orders", where, { status: "paid", paid_at: new Date() }), rule);
      await expectRefused(db, update("orders", where, { status: "paid", paid_attempt_id: attempt.id }), rule);
      await expectRefused(db, update("orders", where, { paid_attempt_id: attempt.id, paid_at: new Date() }), rule);
      await expectRefused(db, update("orders", where, { paid_at: new Date() }), rule);
    }),
  );

  it(
    "refuses paid with another order's attempt, or one that doesn't exist",
    withClinic(async (db, clinic) => {
      const { where } = await sentWithSuccess(db, clinic);
      const { attempt: othersAttempt } = await sentWithSuccess(db, clinic);
      const paid = (paidAttemptId: unknown) => ({ status: "paid", paid_at: new Date(), paid_attempt_id: paidAttemptId });
      await expectRefused(db, update("orders", where, paid(othersAttempt.id)), "orders_paid_attempt_fk");
      await expectRefused(db, update("orders", where, paid("01900000-0000-7000-8000-000000000000")), "orders_paid_attempt_fk");
    }),
  );
});

describe("a success has a charge reference", () => {
  it(
    "refuses a succeeded attempt with no charge_ref",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      await expectAccepted(db, insertInto("payment_attempts", succeededAttempt(order.id)));
      await expectRefused(
        db,
        insertInto("payment_attempts", succeededAttempt(order.id, { charge_ref: null })),
        "payment_attempts_success_has_charge_ref",
      );
      const pending = await accepted(db, insertInto("payment_attempts", payAttempt(order.id)));
      await expectRefused(
        db,
        update("payment_attempts", { id: pending.id }, { status: "succeeded", settled_by: "sweep", settled_at: new Date() }),
        "payment_attempts_success_has_charge_ref",
      );
      // Other outcomes have nothing to trace.
      await expectAccepted(db, insertInto("payment_attempts", payAttempt(order.id, { status: "declined" })));
    }),
  );
});

describe("status and timestamps agree", () => {
  it(
    "refuses words outside each status list",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      await expectRefused(db, insertInto("orders", draftOrder(clinic, { status: "shipped" })), "orders_status_known");
      await expectRefused(db, insertInto("orders", draftOrder(clinic, { status: "Draft" })), "orders_status_known");
      await expectRefused(
        db,
        insertInto("payment_attempts", payAttempt(order.id, { status: "refunded" })),
        "payment_attempts_status_known",
      );
      await expectRefused(
        db,
        insertInto("payment_attempts", payAttempt(order.id, { status: "declined", settled_by: "cron" })),
        "payment_attempts_settled_by_known",
      );
      await expectRefused(
        db,
        insertInto("order_events", { order_id: order.id, kind: "sent", actor_type: "admin" }),
        "order_events_actor_type_known",
      );
    }),
  );

  it.each(["sent", "needs_review"])(
    "refuses a %s order with no sent_at",
    (status) =>
      withClinic(async (db, clinic) => {
        await expectAccepted(db, insertInto("orders", sentOrder(clinic, { status })));
        await expectRefused(
          db,
          insertInto("orders", sentOrder(clinic, { status, sent_at: null })),
          "orders_sent_has_sent_at",
        );
      })(),
  );

  it(
    "refuses a paid order with no sent_at",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const attempt = await accepted(db, insertInto("payment_attempts", succeededAttempt(order.id)));
      const paid = { status: "paid", paid_at: new Date(), paid_attempt_id: attempt.id };
      await expectRefused(db, update("orders", { id: order.id }, { ...paid, sent_at: null }), "orders_sent_has_sent_at");
      await expectAccepted(db, update("orders", { id: order.id }, paid));
    }),
  );

  it(
    "refuses a draft with a sent_at",
    withClinic(async (db, clinic) => {
      await expectRefused(db, insertInto("orders", sentOrder(clinic, { status: "draft" })), "orders_draft_not_sent");
    }),
  );

  it.each(Object.keys(sendColumns()).filter((column) => column !== "sent_at"))(
    "refuses a sent order with no %s, since Send sets it",
    (column) =>
      withClinic(async (db, clinic) => {
        await expectRefused(db, insertInto("orders", sentOrder(clinic, { [column]: null })), "orders_send_fields_set");
      })(),
  );

  it(
    "requires cancelled_at exactly when cancelled",
    withClinic(async (db, clinic) => {
      const rule = "orders_cancelled_has_cancelled_at";
      // A discarded draft never had Send's columns; a cancelled order keeps them.
      await expectAccepted(db, insertInto("orders", draftOrder(clinic, { status: "cancelled", cancelled_at: new Date() })));
      await expectAccepted(db, insertInto("orders", sentOrder(clinic, { status: "cancelled", cancelled_at: new Date() })));
      await expectRefused(db, insertInto("orders", draftOrder(clinic, { status: "cancelled" })), rule);
      await expectRefused(db, insertInto("orders", sentOrder(clinic, { cancelled_at: new Date() })), rule);
    }),
  );
});

describe("each product appears once per order", () => {
  it(
    "refuses a second line for the same product",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      const other = await insertDraft(db, clinic);
      await accepted(db, insertInto("order_lines", draftLine(order.id, clinic.magnesiumId)));
      await expectAccepted(db, insertInto("order_lines", draftLine(order.id, clinic.vitaminDId)));
      await expectAccepted(db, insertInto("order_lines", draftLine(other.id, clinic.magnesiumId)));
      await expectRefused(
        db,
        insertInto("order_lines", draftLine(order.id, clinic.magnesiumId, { quantity: 2 })),
        "order_lines_one_per_product",
      );
    }),
  );
});

describe("quantity is 1–10", () => {
  it(
    "accepts 1 and 10, and refuses 0, 11 and -1",
    withClinic(async (db, clinic) => {
      const order = await insertDraft(db, clinic);
      const line = (quantity: number) => insertInto("order_lines", draftLine(order.id, clinic.magnesiumId, { quantity }));
      await expectAccepted(db, line(1));
      await expectAccepted(db, line(10));
      for (const quantity of [0, 11, -1]) await expectRefused(db, line(quantity), "order_lines_quantity_range");
    }),
  );
});

describe("the audit trail is append-only", () => {
  it(
    "accepts new events and refuses changing or deleting them",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const event = await accepted(
        db,
        insertInto("order_events", {
          order_id: order.id,
          kind: "sent",
          actor_type: "provider",
          actor_id: clinic.providerId,
          details: { lines: 1 },
        }),
      );
      await expectRefused(db, update("order_events", { id: event.id }, { kind: "cancelled" }), "order_events_append_only");
      await expectRefused(db, deleteFrom("order_events", { id: event.id }), "order_events_append_only");
    }),
  );

  it(
    "leaves actor_id empty for the sweep and the system",
    withClinic(async (db, clinic) => {
      const order = await seedSentOrder(db, clinic);
      const event = (actorType: string, actorId: string | null) =>
        insertInto("order_events", { order_id: order.id, kind: "paid", actor_type: actorType, actor_id: actorId });
      await expectAccepted(db, event("sweep", null));
      await expectAccepted(db, event("patient", null)); // §5's Pay records no patient id
      await expectRefused(db, event("sweep", clinic.providerId), "order_events_system_has_no_actor");
      await expectRefused(db, event("system", clinic.providerId), "order_events_system_has_no_actor");
    }),
  );
});

describe("indexes (§7)", () => {
  it("has the Sales, sweep, and double-charge indexes", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
    );
    const defs = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs.orders_provider_created_idx).toMatch(/\(provider_id, created_at DESC\)/);
    expect(defs.orders_provider_sent_idx).toMatch(/\(provider_id, sent_at DESC\)/);
    expect(defs.orders_provider_paid_idx).toMatch(/\(provider_id, paid_at DESC\)/);
    expect(defs.payment_attempts_pending_created_idx).toMatch(/\(created_at\) WHERE \(status = 'pending'::text\)/);
    expect(defs.one_live_attempt_per_order).toMatch(
      /UNIQUE INDEX one_live_attempt_per_order ON public\.payment_attempts USING btree \(order_id\) WHERE \(status = ANY \(ARRAY\['pending'::text, 'succeeded'::text\]\)\)/,
    );
    expect(defs.payment_attempts_pay_key_once).toMatch(/UNIQUE INDEX .*\(idempotency_key\)/);
  });
});
