// `npm run reconcile` (ARCHITECTURE.md §7): what the database can't express.
// Each paid order's totals equal its lines; each paid order has exactly one
// succeeded attempt for its total; no unpaid order has one; and no attempt
// has been pending longer than the sweep allows.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcile } from "@/server/reporting/reconcile";
import { makeClinic, type Scratch, scratchDatabase, type TestClinic } from "./scratch";

let scratch: Scratch;
let clinic: TestClinic;
const NOW = new Date("2026-10-07T12:00:00Z");

beforeAll(async () => {
  scratch = await scratchDatabase("reconcile");
  clinic = await makeClinic(scratch.pool);
}, 30_000);
afterAll(() => scratch?.drop());

const check = () => reconcile({ db: scratch.db, now: () => NOW, sweepAfterMs: 15_000 });

function command(): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["scripts/reconcile.ts"], {
      env: { ...process.env, DATABASE_URL: scratch.url },
      encoding: "utf8",
    });
    return { code: 0, output };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { code: failed.status, output: failed.stdout };
  }
}

/**
 * A sent order built straight in SQL, the way Send would, but with the order's
 * totals free to disagree with its one $36.00 line. The database checks that
 * the totals add up among themselves, not that they match the lines.
 */
async function sentOrder(totals = { total: 3600, cost: 2000, fee: 27, margin: 1573 }): Promise<{ id: string; ref: string }> {
  const ref = `${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase().replace(/[01IOL]/g, "Z");
  const { rows } = await scratch.pool.query(
    "INSERT INTO orders (ref, provider_id, practice_id, patient_id, status) VALUES ($1, $2, $3, $4, 'draft') RETURNING id",
    [ref, clinic.provider.id, clinic.practiceId, clinic.patientId],
  );
  const id = rows[0].id;
  await scratch.pool.query(
    `INSERT INTO order_lines (order_id, catalog_item_id, quantity, unit_price_cents, frozen_at, unit_cost_cents, fee_rate_bps,
       unit_fee_cents, unit_margin_cents, unit_msrp_cents, product_name, image_path, image_alt)
     VALUES ($1, $2, 1, 3600, now(), 2000, 75, 27, 1573, 4000, 'Magnesium Glycinate, 120 capsules', '/p.svg', 'Magnesium')`,
    [id, clinic.magnesiumId],
  );
  await scratch.pool.query(
    `UPDATE orders SET status = 'sent', sent_at = now(), fee_rate_bps = 75, link_version = 1, link_expires_at = now() + interval '30 days',
       total_cents = $2, cost_cents = $3, fee_cents = $4, margin_cents = $5 WHERE id = $1`,
    [id, totals.total, totals.cost, totals.fee, totals.margin],
  );
  return { id, ref };
}

async function attempt(orderId: string, status: string, amount: number, createdAt = NOW): Promise<string> {
  const settled = status === "pending" ? {} : { charge_ref: status === "succeeded" ? "ch_test" : null, settled_by: "request", settled_at: NOW };
  const { rows } = await scratch.pool.query(
    `INSERT INTO payment_attempts (order_id, idempotency_key, amount_cents, status, charge_ref, settled_by, settled_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [orderId, randomUUID(), amount, status, settled.charge_ref ?? null, settled.settled_by ?? null, settled.settled_at ?? null, createdAt],
  );
  return rows[0].id;
}

async function markPaid(orderId: string, attemptId: string) {
  await scratch.pool.query("UPDATE orders SET status = 'paid', paid_at = now(), paid_attempt_id = $2 WHERE id = $1", [orderId, attemptId]);
}

describe("reconcile", () => {
  it("says every paid order adds up when it does", async () => {
    const order = await sentOrder();
    await markPaid(order.id, await attempt(order.id, "succeeded", 3600));
    expect(await check()).toEqual([]);
    expect(command()).toEqual({ code: 0, output: expect.stringContaining("Every paid order adds up") });
  });

  it("lists each problem, and the command fails", async () => {
    // Totals of $72.00 on a $36.00 order.
    const wrongTotals = await sentOrder({ total: 7200, cost: 4000, fee: 54, margin: 3146 });
    await markPaid(wrongTotals.id, await attempt(wrongTotals.id, "succeeded", 7200));
    // Paid with an attempt for the wrong amount.
    const wrongAmount = await sentOrder();
    await markPaid(wrongAmount.id, await attempt(wrongAmount.id, "succeeded", 3500));
    // A succeeded attempt on an order that isn't paid.
    const unpaid = await sentOrder();
    await attempt(unpaid.id, "succeeded", 3600);
    // An attempt left pending far longer than the sweep allows.
    const stuck = await sentOrder();
    await attempt(stuck.id, "pending", 3600, new Date(NOW.getTime() - 10 * 60_000));

    const problems = await check();
    expect(problems).toHaveLength(4);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${wrongTotals.ref}: the order's totals ($72.00) don't match its lines ($36.00)`),
        expect.stringContaining(`${wrongAmount.ref}: the payment was for $35.00, not the order's $36.00`),
        expect.stringContaining(`${unpaid.ref}: a payment succeeded, but the order isn't paid`),
        expect.stringContaining(`${stuck.ref}: a payment has been pending for 10 minutes`),
      ]),
    );
    const run = command();
    expect(run.code).toBe(1);
    expect(run.output).toContain(wrongTotals.ref);
  });
});
