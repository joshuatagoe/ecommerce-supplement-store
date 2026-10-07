// Pricing: the money rules of ARCHITECTURE.md §7 (D17, D28, D5, D14) as pure
// functions on integer cents and basis points (75 = 0.75%). It imports nothing,
// because the same module runs in the browser and on the server (D33).
// The golden cases in tests/golden/ pin it down.

export type Split = { priceCents: number; costCents: number; feeCents: number; marginCents: number };

export type PriceCheck =
  | { ok: true; lowestPriceCents: number; msrpCents: number }
  | {
      ok: false;
      code: "PRICE_BELOW_LOWEST" | "PRICE_ABOVE_RETAIL";
      lowestPriceCents: number;
      msrpCents: number;
    };

const WHOLE_BPS = 10_000;

/** ceil(price × rate ÷ 10,000): 0.75% of the price, rounded up to a whole cent (D17). */
export function feeCents({ priceCents, feeRateBps }: { priceCents: number; feeRateBps: number }): number {
  return ceilDiv(BigInt(cents("priceCents", priceCents)) * BigInt(rate(feeRateBps)), WHOLE_BPS);
}

/** One bottle's split. The margin is what's left, so it is negative below the lowest price. */
export function unitSplit({
  priceCents,
  costCents,
  feeRateBps,
}: {
  priceCents: number;
  costCents: number;
  feeRateBps: number;
}): Split {
  cents("costCents", costCents);
  const fee = feeCents({ priceCents, feeRateBps });
  return { priceCents, costCents, feeCents: fee, marginCents: priceCents - fee - costCents };
}

/** Each part of the unit split × quantity (D28), so its priceCents is the line total. */
export function lineSplit({
  priceCents,
  costCents,
  feeRateBps,
  quantity,
}: {
  priceCents: number;
  costCents: number;
  feeRateBps: number;
  quantity: number;
}): Split {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a whole number of at least 1, not ${quantity}`);
  }
  const unit = unitSplit({ priceCents, costCents, feeRateBps });
  return {
    priceCents: exact(unit.priceCents * quantity),
    costCents: exact(unit.costCents * quantity),
    feeCents: exact(unit.feeCents * quantity),
    marginCents: exact(unit.marginCents * quantity),
  };
}

/**
 * Each part summed over the lines; no lines gives all zeros. A line's margin
 * may be negative (a draft line below its lowest price), but every part must
 * be whole cents, and price, cost and fee can't be negative.
 */
export function orderTotals(lines: Split[]): Split {
  const totals: Split = { priceCents: 0, costCents: 0, feeCents: 0, marginCents: 0 };
  for (const line of lines) {
    totals.priceCents = exact(totals.priceCents + cents("priceCents", line.priceCents));
    totals.costCents = exact(totals.costCents + cents("costCents", line.costCents));
    totals.feeCents = exact(totals.feeCents + cents("feeCents", line.feeCents));
    totals.marginCents = exact(totals.marginCents + whole("marginCents", line.marginCents));
  }
  return totals;
}

/** The smallest price whose margin is at least zero: the no-profit price (D3). */
export function lowestPriceCents({ costCents, feeRateBps }: { costCents: number; feeRateBps: number }): number {
  return priceForMarginCents({ marginCents: 0, costCents, feeRateBps });
}

/**
 * The smallest price whose margin is exactly marginCents (D5).
 *
 * After the fee, a price p keeps p − ceil(p × rate ÷ 10,000), which equals
 * floor(p × (10,000 − rate) ÷ 10,000). That grows by 0¢ or 1¢ for each extra
 * cent of price, so every margin is reachable, and the first price that keeps
 * at least cost + margin keeps exactly that much:
 * ceil((cost + margin) × 10,000 ÷ (10,000 − rate)).
 */
export function priceForMarginCents({
  marginCents,
  costCents,
  feeRateBps,
}: {
  marginCents: number;
  costCents: number;
  feeRateBps: number;
}): number {
  const keep = BigInt(cents("marginCents", marginCents)) + BigInt(cents("costCents", costCents));
  const keptPerWhole = WHOLE_BPS - rate(feeRateBps);
  if (keptPerWhole === 0) {
    // A 100% fee leaves nothing, so only a free item at no margin has a price.
    if (keep === 0n) return 0;
    throw new RangeError(`no price earns ${marginCents}¢ on a ${costCents}¢ cost when the fee is 100%`);
  }
  return ceilDiv(keep * BigInt(WHOLE_BPS), keptPerWhole);
}

/** ok when lowest price ≤ price ≤ MSRP (D14). Below the lowest wins over above MSRP. */
export function checkPrice({
  priceCents,
  costCents,
  msrpCents,
  feeRateBps,
}: {
  priceCents: number;
  costCents: number;
  msrpCents: number;
  feeRateBps: number;
}): PriceCheck {
  cents("priceCents", priceCents);
  cents("msrpCents", msrpCents);
  const bounds = { lowestPriceCents: lowestPriceCents({ costCents, feeRateBps }), msrpCents };
  if (priceCents < bounds.lowestPriceCents) return { ok: false, code: "PRICE_BELOW_LOWEST", ...bounds };
  if (priceCents > msrpCents) return { ok: false, code: "PRICE_ABOVE_RETAIL", ...bounds };
  return { ok: true, ...bounds };
}

// Integers past 2^53 can't be told apart as JavaScript numbers (about $90
// trillion in cents), so anything that big is refused rather than rounded.

function whole(name: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a whole number of cents, not ${value}`);
  return value;
}

function cents(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole, non-negative number of cents, not ${value}`);
  }
  return value;
}

function rate(feeRateBps: number): number {
  if (!Number.isInteger(feeRateBps) || feeRateBps < 0 || feeRateBps > WHOLE_BPS) {
    throw new RangeError(`feeRateBps must be a whole number from 0 to 10000, not ${feeRateBps}`);
  }
  return feeRateBps;
}

function exact(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${value} cents is too large to count exactly`);
  return value;
}

// ceil(numerator ÷ divisor) for a non-negative numerator. The numerator is a
// BigInt so price × rate stays exact even when it passes 2^53.
function ceilDiv(numerator: bigint, divisor: number): number {
  const d = BigInt(divisor);
  return exact(Number((numerator + d - 1n) / d));
}
