// The golden money cases (ARCHITECTURE.md §13), approved and frozen with D43.
// Changing an expected value means changing a money rule, which needs the
// user's OK. money.test.ts runs them against the Pricing contract (§7).

export const FEE_RATE_BPS = 75;

// $20.00 cost: the lowest price is $20.16, because at $20.15 the fee rounds up
// to 16¢ and the margin would be −1¢ (D17).
export const lowestPriceCases = [{ costCents: 2000, expected: 2016 }];

// $38.00: 0.75% is 28.5¢, rounded up to 29¢ (D17).
export const feeCases = [{ priceCents: 3800, expected: 29 }];

// Sam's line: $36.00 on a $20.00 cost has a 27¢ fee and earns $15.73.
export const unitCases = [
  {
    priceCents: 3600,
    costCents: 2000,
    expected: { priceCents: 3600, costCents: 2000, feeCents: 27, marginCents: 1573 },
  },
];

// Two bottles at $36.10: 28¢ fee each (56¢), earning $31.64, not $31.65 (D28).
export const lineCases = [
  {
    priceCents: 3610,
    costCents: 2000,
    quantity: 2,
    expected: { priceCents: 7220, costCents: 4000, feeCents: 56, marginCents: 3164 },
  },
];
