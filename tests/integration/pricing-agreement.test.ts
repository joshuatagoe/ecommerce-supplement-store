// The database's frozen-line rules and the shared Pricing module must agree
// (ARCHITECTURE.md §7): for random prices, costs, MSRPs and rates, a line
// frozen from Pricing's split is accepted exactly when checkPrice says ok, and
// a fee 1¢ off Pricing's is always refused.
import fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { checkPrice, unitSplit } from "@/shared/pricing";
import { accepted, draftOrder, frozenLine, insertInto, outcome, rolledBack, seedClinic, testPool } from "./fixtures";

const pool = testPool();
afterAll(() => pool.end());

const cents = fc.integer({ min: 0, max: 200_000 });
const rate = fc.oneof(fc.constant(75), fc.integer({ min: 0, max: 9999 }));

it("accepts a frozen line exactly when Pricing says its price is in range", () =>
  rolledBack(pool, async (db) => {
    const clinic = await seedClinic(db);
    // Send freezes lines while the order is still a draft (§8).
    const order = await accepted(db, insertInto("orders", draftOrder(clinic)));
    await fc.assert(
      fc.asyncProperty(cents, cents, cents, rate, async (priceCents, costCents, msrpCents, feeRateBps) => {
        const split = unitSplit({ priceCents, costCents, feeRateBps });
        const line = (fee: number) =>
          insertInto(
            "order_lines",
            frozenLine(order.id, clinic.magnesiumId, {
              unit_price_cents: priceCents,
              unit_cost_cents: costCents,
              fee_rate_bps: feeRateBps,
              unit_fee_cents: fee,
              unit_margin_cents: priceCents - costCents - fee,
              unit_msrp_cents: msrpCents,
            }),
          );
        const { ok } = checkPrice({ priceCents, costCents, msrpCents, feeRateBps });
        const error = await outcome(db, line(split.feeCents));
        expect(error === undefined, error?.message).toBe(ok);
        // A fee 1¢ off, with the margin moved so the parts still add up.
        expect((await outcome(db, line(split.feeCents + 1)))?.code).toMatch(/^23/);
        if (split.feeCents > 0) expect((await outcome(db, line(split.feeCents - 1)))?.code).toMatch(/^23/);
      }),
      { numRuns: 300 },
    );
  }));
