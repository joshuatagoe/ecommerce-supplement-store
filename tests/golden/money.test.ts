// Runs the frozen golden cases against the Pricing contract (ARCHITECTURE.md §7).
import { describe, expect, it } from "vitest";
import { feeCents, lineSplit, lowestPriceCents, unitSplit } from "@/shared/pricing";
import { FEE_RATE_BPS, feeCases, lineCases, lowestPriceCases, unitCases } from "./money.cases";

const feeRateBps = FEE_RATE_BPS;

describe("golden money cases", () => {
  it.each(lowestPriceCases)("cost $costCents → lowest price $expected", ({ costCents, expected }) => {
    expect(lowestPriceCents({ costCents, feeRateBps })).toBe(expected);
  });

  it.each(feeCases)("price $priceCents → fee $expected", ({ priceCents, expected }) => {
    expect(feeCents({ priceCents, feeRateBps })).toBe(expected);
  });

  it.each(unitCases)("1 × $priceCents on cost $costCents", ({ priceCents, costCents, expected }) => {
    expect(unitSplit({ priceCents, costCents, feeRateBps })).toEqual(expected);
  });

  it.each(lineCases)(
    "$quantity × $priceCents on cost $costCents",
    ({ priceCents, costCents, quantity, expected }) => {
      expect(lineSplit({ priceCents, costCents, feeRateBps, quantity })).toEqual(expected);
    },
  );
});
