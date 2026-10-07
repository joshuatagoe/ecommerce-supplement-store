// Worked examples for the Pricing contract (ARCHITECTURE.md §7) beyond the
// frozen golden cases: edges, checkPrice, orderTotals and the RangeError rules.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const feeRateBps = 75;
const sam = { priceCents: 3600, costCents: 2000, feeCents: 27, marginCents: 1573 };

describe("feeCents", () => {
  it.each([
    { priceCents: 3600, expected: 27 }, // 27.0¢ exactly, so nothing to round
    { priceCents: 3601, expected: 28 }, // 27.0075¢ rounds up
    { priceCents: 3800, expected: 29 }, // 28.5¢ rounds up, not to even
    { priceCents: 1, expected: 1 }, // a fraction of a cent is still a cent
    { priceCents: 0, expected: 0 },
  ])("$priceCents¢ at 75 bps → $expected¢", ({ priceCents, expected }) => {
    expect(feeCents({ priceCents, feeRateBps })).toBe(expected);
  });

  it("is zero at a 0 bps rate and the whole price at 10,000 bps", () => {
    expect(feeCents({ priceCents: 3600, feeRateBps: 0 })).toBe(0);
    expect(feeCents({ priceCents: 3600, feeRateBps: 10_000 })).toBe(3600);
  });

  it("stays exact past 2^53 in the intermediate product", () => {
    // 9,007,199,254,740,991 × 75 doesn't fit a double; the answer still must.
    expect(feeCents({ priceCents: Number.MAX_SAFE_INTEGER, feeRateBps })).toBe(67_553_994_410_558);
  });
});

describe("unitSplit", () => {
  it("returns Sam's split", () => {
    expect(unitSplit({ priceCents: 3600, costCents: 2000, feeRateBps })).toEqual(sam);
  });

  it("goes negative below the lowest price instead of throwing", () => {
    expect(unitSplit({ priceCents: 2015, costCents: 2000, feeRateBps })).toEqual({
      priceCents: 2015,
      costCents: 2000,
      feeCents: 16,
      marginCents: -1,
    });
  });
});

describe("lineSplit", () => {
  it("is the unit split for one bottle", () => {
    expect(lineSplit({ priceCents: 3600, costCents: 2000, feeRateBps, quantity: 1 })).toEqual(sam);
  });

  it("leaves the 1–10 cap to Orders and the database", () => {
    expect(lineSplit({ priceCents: 3600, costCents: 2000, feeRateBps, quantity: 11 })).toEqual({
      priceCents: 39_600,
      costCents: 22_000,
      feeCents: 297,
      marginCents: 17_303,
    });
  });

  it("multiplies a negative margin too", () => {
    expect(lineSplit({ priceCents: 2015, costCents: 2000, feeRateBps, quantity: 3 }).marginCents).toBe(-3);
  });
});

describe("orderTotals", () => {
  it("is all zeros with no lines", () => {
    expect(orderTotals([])).toEqual({ priceCents: 0, costCents: 0, feeCents: 0, marginCents: 0 });
  });

  it("adds each part over the lines", () => {
    const twoAt3610 = lineSplit({ priceCents: 3610, costCents: 2000, feeRateBps, quantity: 2 });
    expect(orderTotals([sam, twoAt3610])).toEqual({
      priceCents: 10_820,
      costCents: 6000,
      feeCents: 83,
      marginCents: 4737,
    });
  });

  it("accepts a line below the lowest price, whose margin is negative", () => {
    const below = unitSplit({ priceCents: 2015, costCents: 2000, feeRateBps });
    expect(orderTotals([sam, below]).marginCents).toBe(1572);
  });
});

describe("lowestPriceCents", () => {
  it.each([
    { costCents: 2000, feeRateBps: 75, expected: 2016 },
    { costCents: 0, feeRateBps: 75, expected: 0 },
    { costCents: 2000, feeRateBps: 0, expected: 2000 },
    { costCents: 0, feeRateBps: 10_000, expected: 0 },
    { costCents: 1, feeRateBps: 9999, expected: 10_000 }, // keeps 1¢ in every $100
  ])("cost $costCents¢ at $feeRateBps bps → $expected¢", ({ costCents, feeRateBps: rate, expected }) => {
    expect(lowestPriceCents({ costCents, feeRateBps: rate })).toBe(expected);
  });

  it("throws when a 100% fee leaves no price that covers the cost", () => {
    expect(() => lowestPriceCents({ costCents: 1, feeRateBps: 10_000 })).toThrow(RangeError);
  });
});

describe("priceForMarginCents", () => {
  it("picks $36.00, not $36.01, for a $15.73 margin on a $20.00 cost (D5)", () => {
    expect(priceForMarginCents({ marginCents: 1573, costCents: 2000, feeRateBps })).toBe(3600);
    expect(unitSplit({ priceCents: 3601, costCents: 2000, feeRateBps }).marginCents).toBe(1573);
  });

  it("is the lowest price for a zero margin", () => {
    expect(priceForMarginCents({ marginCents: 0, costCents: 2000, feeRateBps })).toBe(2016);
  });

  it("lands on 1¢ exactly", () => {
    const priceCents = priceForMarginCents({ marginCents: 1, costCents: 2000, feeRateBps });
    expect(priceCents).toBe(2017);
    expect(unitSplit({ priceCents, costCents: 2000, feeRateBps }).marginCents).toBe(1);
  });

  it("throws when a 100% fee leaves no price that earns the margin", () => {
    expect(() => priceForMarginCents({ marginCents: 1, costCents: 0, feeRateBps: 10_000 })).toThrow(RangeError);
    expect(priceForMarginCents({ marginCents: 0, costCents: 0, feeRateBps: 10_000 })).toBe(0);
  });
});

describe("checkPrice", () => {
  const bounds = { lowestPriceCents: 2016, msrpCents: 4000 };
  const check = (priceCents: number, msrpCents = 4000) =>
    checkPrice({ priceCents, costCents: 2000, msrpCents, feeRateBps });

  it("is ok from the lowest price up to MSRP, inclusive", () => {
    expect(check(2016)).toEqual({ ok: true, ...bounds });
    expect(check(3600)).toEqual({ ok: true, ...bounds });
    expect(check(4000)).toEqual({ ok: true, ...bounds });
  });

  it("refuses 1¢ below the lowest price", () => {
    expect(check(2015)).toEqual({ ok: false, code: "PRICE_BELOW_LOWEST", ...bounds });
  });

  it("refuses 1¢ above MSRP", () => {
    expect(check(4001)).toEqual({ ok: false, code: "PRICE_ABOVE_RETAIL", ...bounds });
  });

  it("says below-lowest when the price is also above an MSRP under the lowest price", () => {
    expect(check(2010, 2005)).toEqual({
      ok: false,
      code: "PRICE_BELOW_LOWEST",
      lowestPriceCents: 2016,
      msrpCents: 2005,
    });
  });
});

describe("bad input throws a RangeError", () => {
  const notCents = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
  const badRates = [-1, 10_001, 7.5, Number.NaN];
  const badQuantities = [0, -1, 1.5, Number.NaN];
  const good = { priceCents: 3600, costCents: 2000, msrpCents: 4000, marginCents: 1573, feeRateBps, quantity: 1 };

  const calls: [name: string, call: (input: typeof good) => unknown][] = [
    ["feeCents", (i) => feeCents(i)],
    ["unitSplit", (i) => unitSplit(i)],
    ["lineSplit", (i) => lineSplit(i)],
    ["lowestPriceCents", (i) => lowestPriceCents(i)],
    ["priceForMarginCents", (i) => priceForMarginCents(i)],
    ["checkPrice", (i) => checkPrice(i)],
  ];
  const amountsOf: Record<string, (keyof typeof good)[]> = {
    feeCents: ["priceCents"],
    unitSplit: ["priceCents", "costCents"],
    lineSplit: ["priceCents", "costCents"],
    lowestPriceCents: ["costCents"],
    priceForMarginCents: ["marginCents", "costCents"],
    checkPrice: ["priceCents", "costCents", "msrpCents"],
  };

  it.each(calls)("%s accepts the good input", (_name, call) => {
    expect(() => call(good)).not.toThrow();
  });

  it.each(calls)("%s refuses an amount that isn't whole, non-negative cents", (name, call) => {
    for (const field of amountsOf[name]) {
      for (const value of notCents) {
        expect(() => call({ ...good, [field]: value }), `${field} = ${value}`).toThrow(RangeError);
      }
    }
  });

  it.each(calls)("%s refuses a rate outside 0–10,000 bps", (_name, call) => {
    for (const value of badRates) {
      expect(() => call({ ...good, feeRateBps: value }), `feeRateBps = ${value}`).toThrow(RangeError);
    }
  });

  it("lineSplit refuses a quantity below 1 or not whole", () => {
    for (const quantity of badQuantities) {
      expect(() => lineSplit({ ...good, quantity }), `quantity = ${quantity}`).toThrow(RangeError);
    }
    // 1.5 × these parts would come out whole, so only the quantity check refuses it.
    expect(() => lineSplit({ priceCents: 200, costCents: 100, feeRateBps: 0, quantity: 1.5 })).toThrow(RangeError);
  });

  it("lineSplit refuses a line too large to count exactly", () => {
    expect(() =>
      lineSplit({ priceCents: Number.MAX_SAFE_INTEGER, costCents: 0, feeRateBps, quantity: 2 }),
    ).toThrow(RangeError);
  });

  it("orderTotals refuses a part that isn't whole cents, or a negative price, cost or fee", () => {
    for (const line of [
      { ...sam, priceCents: 1.5 },
      { ...sam, costCents: -1 },
      { ...sam, feeCents: Number.NaN },
      { ...sam, marginCents: 0.5 },
    ]) {
      expect(() => orderTotals([line]), JSON.stringify(line)).toThrow(RangeError);
    }
  });
});

describe("the Pricing module", () => {
  // It runs in the browser too, so it may import nothing but its own files (§7).
  it("imports no Node, server or third-party code", () => {
    const folder = "src/shared/pricing";
    const specifiers = readdirSync(folder)
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(join(folder, file), "utf8");
        return [...source.matchAll(/(?:\bfrom|\bimport|\brequire\()\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
      });
    expect(specifiers.filter((specifier) => !specifier.startsWith("./"))).toEqual([]);
  });
});
