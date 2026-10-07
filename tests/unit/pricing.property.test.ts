// Property tests for Pricing (ARCHITECTURE.md §13): for thousands of random
// prices, costs and rates, the parts add up, the margin is never negative at or
// above the lowest price, the fee always rounds up, and a typed margin lands
// exactly on itself at the lowest such price.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkPrice,
  feeCents,
  lineSplit,
  lowestPriceCents,
  orderTotals,
  priceForMarginCents,
  unitSplit,
} from "@/shared/pricing";

const runs = { numRuns: 2000 };

// Up to $1M a bottle covers any real supplement with room to spare.
const cents = fc.integer({ min: 0, max: 100_000_000 });
const anyCents = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
// 75 bps is the real rate, so it gets extra weight. 10,000 bps (a 100% fee)
// has no lowest price once there is a cost, so it is tested on its own.
const rate = fc.oneof(fc.constant(75), fc.integer({ min: 0, max: 9999 }));
const anyRate = fc.integer({ min: 0, max: 10_000 });
const quantity = fc.integer({ min: 1, max: 10 });

// The fee from its definition, in BigInt so nothing rounds: ceil(price × rate ÷ 10,000).
const exactFee = (priceCents: number, feeRateBps: number) =>
  Number((BigInt(priceCents) * BigInt(feeRateBps) + 9999n) / 10_000n);

const margin = (priceCents: number, costCents: number, feeRateBps: number) =>
  unitSplit({ priceCents, costCents, feeRateBps }).marginCents;

describe("Pricing properties", () => {
  it("the fee is the exact ceiling of price × rate, for any safe price", () => {
    fc.assert(
      fc.property(anyCents, anyRate, (priceCents, feeRateBps) => {
        const fee = feeCents({ priceCents, feeRateBps });
        const owed = BigInt(priceCents) * BigInt(feeRateBps);
        expect(fee).toBe(exactFee(priceCents, feeRateBps));
        // Rounds up: covers what's owed, and 1¢ less wouldn't.
        expect(BigInt(fee) * 10_000n >= owed).toBe(true);
        expect(BigInt(fee - 1) * 10_000n < owed).toBe(true);
      }),
      runs,
    );
  });

  it("a unit split's cost, fee and margin add up to its price", () => {
    fc.assert(
      fc.property(cents, cents, anyRate, (priceCents, costCents, feeRateBps) => {
        const split = unitSplit({ priceCents, costCents, feeRateBps });
        expect(split.priceCents).toBe(priceCents);
        expect(split.costCents).toBe(costCents);
        expect(split.feeCents).toBe(feeCents({ priceCents, feeRateBps }));
        expect(split.costCents + split.feeCents + split.marginCents).toBe(split.priceCents);
      }),
      runs,
    );
  });

  it("a line is its unit split times the quantity, and still adds up", () => {
    fc.assert(
      fc.property(cents, cents, anyRate, quantity, (priceCents, costCents, feeRateBps, qty) => {
        const unit = unitSplit({ priceCents, costCents, feeRateBps });
        const line = lineSplit({ priceCents, costCents, feeRateBps, quantity: qty });
        expect(line).toEqual({
          priceCents: unit.priceCents * qty,
          costCents: unit.costCents * qty,
          feeCents: unit.feeCents * qty,
          marginCents: unit.marginCents * qty,
        });
        expect(line.costCents + line.feeCents + line.marginCents).toBe(line.priceCents);
      }),
      runs,
    );
  });

  it("order totals are the sum of each part, and still add up", () => {
    const line = fc
      .tuple(cents, cents, rate, quantity)
      .map(([priceCents, costCents, feeRateBps, qty]) =>
        lineSplit({ priceCents, costCents, feeRateBps, quantity: qty }),
      );
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const totals = orderTotals(lines);
        const sum = (part: keyof (typeof lines)[number]) => lines.reduce((total, l) => total + l[part], 0);
        expect(totals).toEqual({
          priceCents: sum("priceCents"),
          costCents: sum("costCents"),
          feeCents: sum("feeCents"),
          marginCents: sum("marginCents"),
        });
        expect(totals.costCents + totals.feeCents + totals.marginCents).toBe(totals.priceCents);
      }),
      runs,
    );
  });

  it("the lowest price earns at least zero, and 1¢ less earns below zero", () => {
    fc.assert(
      fc.property(cents, rate, (costCents, feeRateBps) => {
        const lowest = lowestPriceCents({ costCents, feeRateBps });
        expect(margin(lowest, costCents, feeRateBps)).toBeGreaterThanOrEqual(0);
        if (lowest > 0) expect(margin(lowest - 1, costCents, feeRateBps)).toBeLessThan(0);
      }),
      runs,
    );
  });

  it("the margin is never negative at or above the lowest price", () => {
    fc.assert(
      fc.property(cents, rate, cents, (costCents, feeRateBps, above) => {
        const priceCents = lowestPriceCents({ costCents, feeRateBps }) + above;
        expect(margin(priceCents, costCents, feeRateBps)).toBeGreaterThanOrEqual(0);
      }),
      runs,
    );
  });

  it("each extra cent of price adds 0¢ or 1¢ of margin, never 2¢ (why every margin is reachable)", () => {
    fc.assert(
      fc.property(cents, cents, anyRate, (priceCents, costCents, feeRateBps) => {
        const step = margin(priceCents + 1, costCents, feeRateBps) - margin(priceCents, costCents, feeRateBps);
        expect([0, 1]).toContain(step);
      }),
      runs,
    );
  });

  it("a typed margin lands exactly, at the lowest price that earns it", () => {
    fc.assert(
      fc.property(cents, cents, rate, (marginCents, costCents, feeRateBps) => {
        const priceCents = priceForMarginCents({ marginCents, costCents, feeRateBps });
        expect(margin(priceCents, costCents, feeRateBps)).toBe(marginCents);
        if (priceCents > 0) expect(margin(priceCents - 1, costCents, feeRateBps)).toBeLessThan(marginCents);
      }),
      runs,
    );
  });

  it("a zero margin is the lowest price", () => {
    fc.assert(
      fc.property(cents, rate, (costCents, feeRateBps) => {
        expect(priceForMarginCents({ marginCents: 0, costCents, feeRateBps })).toBe(
          lowestPriceCents({ costCents, feeRateBps }),
        );
      }),
      runs,
    );
  });

  it("checkPrice is ok exactly from the lowest price to MSRP, and always returns both bounds", () => {
    fc.assert(
      fc.property(cents, cents, cents, rate, (priceCents, costCents, msrpCents, feeRateBps) => {
        const lowest = lowestPriceCents({ costCents, feeRateBps });
        const result = checkPrice({ priceCents, costCents, msrpCents, feeRateBps });
        const bounds = { lowestPriceCents: lowest, msrpCents };
        if (priceCents < lowest) expect(result).toEqual({ ok: false, code: "PRICE_BELOW_LOWEST", ...bounds });
        else if (priceCents > msrpCents) expect(result).toEqual({ ok: false, code: "PRICE_ABOVE_RETAIL", ...bounds });
        else expect(result).toEqual({ ok: true, ...bounds });
      }),
      runs,
    );
  });

  it("an ok price never has a negative margin or a price above MSRP", () => {
    fc.assert(
      fc.property(cents, cents, cents, rate, (priceCents, costCents, msrpCents, feeRateBps) => {
        fc.pre(checkPrice({ priceCents, costCents, msrpCents, feeRateBps }).ok);
        expect(margin(priceCents, costCents, feeRateBps)).toBeGreaterThanOrEqual(0);
        expect(priceCents).toBeLessThanOrEqual(msrpCents);
      }),
      { numRuns: 500 },
    );
  });

  it("any negative or fractional amount throws a RangeError", () => {
    const negative = fc.integer({ min: -100_000_000, max: -1 });
    const fractional = fc.double({ min: 0, max: 100_000_000, noNaN: true }).filter((n) => !Number.isInteger(n));
    fc.assert(
      fc.property(fc.oneof(negative, fractional), (bad) => {
        expect(() => feeCents({ priceCents: bad, feeRateBps: 75 })).toThrow(RangeError);
        expect(() => unitSplit({ priceCents: 3600, costCents: bad, feeRateBps: 75 })).toThrow(RangeError);
        expect(() => lowestPriceCents({ costCents: bad, feeRateBps: 75 })).toThrow(RangeError);
        expect(() => priceForMarginCents({ marginCents: bad, costCents: 2000, feeRateBps: 75 })).toThrow(RangeError);
        expect(() => checkPrice({ priceCents: 3600, costCents: 2000, msrpCents: bad, feeRateBps: 75 })).toThrow(
          RangeError,
        );
      }),
      runs,
    );
  });
});
