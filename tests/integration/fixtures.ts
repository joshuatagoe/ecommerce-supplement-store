// Shared by the database-rule tests (ARCHITECTURE.md §7). Each test runs in a
// transaction that is always rolled back, because frozen lines and audit
// events can't be deleted. A savepoint around each statement lets a test try a
// refused write and keep going. The rows below pass every rule; a test breaks
// one column to show the rule that refuses it.
import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";
import { expect } from "vitest";

export type Row = Record<string, unknown>;
export type Statement = { text: string; values: unknown[] };
export type Db = pg.PoolClient;

export function testPool(): pg.Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function rolledBack(pool: pg.Pool, body: (db: Db) => Promise<void>): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await body(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}

export function insertInto(table: string, row: Row): Statement {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  return {
    text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values: Object.values(row),
  };
}

export function update(table: string, where: Row, set: Row): Statement {
  const columns = Object.keys(set);
  const keys = Object.keys(where);
  const assignments = columns.map((column, i) => `${column} = $${i + 1}`);
  const conditions = keys.map((key, i) => `${key} = $${columns.length + i + 1}`);
  return {
    text: `UPDATE ${table} SET ${assignments.join(", ")} WHERE ${conditions.join(" AND ")} RETURNING *`,
    values: [...Object.values(set), ...Object.values(where)],
  };
}

export function deleteFrom(table: string, where: Row): Statement {
  const keys = Object.keys(where);
  return {
    text: `DELETE FROM ${table} WHERE ${keys.map((key, i) => `${key} = $${i + 1}`).join(" AND ")} RETURNING *`,
    values: Object.values(where),
  };
}

/** Runs a statement that must succeed, and keeps what it wrote. */
export async function accepted(db: Db, statement: Statement): Promise<Row> {
  await db.query("SAVEPOINT step");
  try {
    const { rows } = await db.query(statement.text, statement.values);
    await db.query("RELEASE SAVEPOINT step");
    return rows[0];
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT step");
    throw new Error(`Expected the database to accept: ${statement.text}\n${(error as Error).message}`);
  }
}

/** Runs a statement, undoes whatever it did, and returns the error it raised, if any. */
export async function outcome(db: Db, statement: Statement): Promise<pg.DatabaseError | undefined> {
  await db.query("SAVEPOINT step");
  try {
    await db.query(statement.text, statement.values);
    return undefined;
  } catch (error) {
    return error as pg.DatabaseError;
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT step");
  }
}

/**
 * The statement must be refused by the named rule: an integrity error (SQLSTATE
 * class 23) that names it. Naming the rule shows that this rule refused the
 * data, not some other rule that happens to cover the same row.
 */
export async function expectRefused(db: Db, statement: Statement, ...rules: string[]): Promise<void> {
  const error = await outcome(db, statement);
  expect(error, `expected ${rules.join(" or ")} to refuse: ${statement.text}`).toBeDefined();
  expect(error?.code, error?.message).toMatch(/^23/);
  expect(rules, error?.message).toContain(error?.constraint);
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0, O, 1, I or L (§6)

export function newRef(): string {
  const pick = () => REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

export type Clinic = {
  practiceId: string;
  providerId: string;
  patientId: string;
  magnesiumId: string;
  vitaminDId: string;
};

/** Lakeview Family Practice, Dr. Rivera, Sam, and two catalog items (§7's running example). */
export async function seedClinic(db: Db): Promise<Clinic> {
  const practice = await accepted(
    db,
    insertInto("practices", { name: "Lakeview Family Practice", time_zone: "America/Los_Angeles" }),
  );
  const provider = await accepted(db, insertInto("providers", { practice_id: practice.id, display_name: "Dr. Rivera" }));
  const patient = await accepted(
    db,
    insertInto("patients", {
      practice_id: practice.id,
      first_name: "Sam",
      last_name: "Okafor",
      email: "sam@example.com",
    }),
  );
  const magnesium = await accepted(db, insertInto("catalog_items", catalogItem()));
  const vitaminD = await accepted(
    db,
    insertInto(
      "catalog_items",
      catalogItem({
        name: "Vitamin D3",
        size_label: "60 softgels",
        image_path: "/products/vitamin-d3.png",
        image_alt: "Vitamin D3, 60 softgels",
        cost_cents: 1000,
        msrp_cents: 2500,
      }),
    ),
  );
  return {
    practiceId: practice.id as string,
    providerId: provider.id as string,
    patientId: patient.id as string,
    magnesiumId: magnesium.id as string,
    vitaminDId: vitaminD.id as string,
  };
}

export function catalogItem(overrides: Row = {}): Row {
  return {
    brand: "Thorne",
    name: "Magnesium Glycinate",
    size_label: "120 capsules",
    image_path: "/products/magnesium-glycinate.png",
    image_alt: "Magnesium Glycinate, 120 capsules",
    cost_cents: 2000,
    msrp_cents: 4000,
    ...overrides,
  };
}

/** A draft has only what §7's column details require. */
export function draftOrder(clinic: Clinic, overrides: Row = {}): Row {
  return {
    ref: newRef(),
    provider_id: clinic.providerId,
    practice_id: clinic.practiceId,
    patient_id: clinic.patientId,
    status: "draft",
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything Send sets (§8): totals for Sam's one bottle at $36.00, the fee rate, and the link. */
export function sendColumns(sentAt = new Date()): Row {
  return {
    sent_at: sentAt,
    fee_rate_bps: 75,
    link_version: 1,
    link_expires_at: new Date(sentAt.getTime() + 30 * DAY_MS),
    total_cents: 3600,
    cost_cents: 2000,
    fee_cents: 27,
    margin_cents: 1573,
  };
}

export function sentOrder(clinic: Clinic, overrides: Row = {}): Row {
  return draftOrder(clinic, { status: "sent", ...sendColumns(), ...overrides });
}

/** A draft line has only what §7's column details require. */
export function draftLine(orderId: unknown, catalogItemId: string, overrides: Row = {}): Row {
  return { order_id: orderId, catalog_item_id: catalogItemId, quantity: 1, unit_price_cents: 3600, ...overrides };
}

/** Sam's line after Send (§7): $36.00 = $20.00 cost + 27¢ fee + $15.73 margin. */
export function frozenLine(orderId: unknown, catalogItemId: string, overrides: Row = {}): Row {
  return draftLine(orderId, catalogItemId, {
    frozen_at: new Date(),
    unit_cost_cents: 2000,
    fee_rate_bps: 75,
    unit_fee_cents: 27,
    unit_margin_cents: 1573,
    unit_msrp_cents: 4000,
    product_name: "Magnesium Glycinate, 120 capsules",
    image_path: "/products/magnesium-glycinate.png",
    image_alt: "Magnesium Glycinate, 120 capsules",
    ...overrides,
  });
}

export function payAttempt(orderId: unknown, overrides: Row = {}): Row {
  return { order_id: orderId, idempotency_key: randomUUID(), amount_cents: 3600, status: "pending", ...overrides };
}

export function succeededAttempt(orderId: unknown, overrides: Row = {}): Row {
  return payAttempt(orderId, {
    status: "succeeded",
    charge_ref: `ch_${randomUUID().slice(0, 8)}`,
    settled_by: "request",
    settled_at: new Date(),
    ...overrides,
  });
}

/** A sent order with Sam's frozen line on it. */
export async function seedSentOrder(db: Db, clinic: Clinic, overrides: Row = {}): Promise<Row> {
  const order = await accepted(db, insertInto("orders", sentOrder(clinic, overrides)));
  await accepted(db, insertInto("order_lines", frozenLine(order.id, clinic.magnesiumId)));
  return order;
}
