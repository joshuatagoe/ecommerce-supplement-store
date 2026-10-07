// Showing and reading money (ARCHITECTURE.md §7, §9). Amounts stay integer
// cents everywhere; these functions only turn them into text and back, without
// going through floating point.
import type { PriceCheck } from "./pricing/index.ts";

/** 3600 → "$36.00"; 123456 → "$1,234.56"; −1 → "−$0.01". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * What a provider typed, as cents: "36", "36.5", "$36.01" and "1,234.56" all
 * work. Anything else, including more than two decimal places or a minus sign,
 * is null, so the caller can say the price isn't readable.
 */
export function parseDollars(typed: string): number | null {
  const match = /^\$?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  const dollars = Number(match[1].replaceAll(",", "") || "0");
  const cents = Number((match[2] ?? "0").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Cents as the value of a price field: 3600 → "36.00". */
export function centsToField(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

type Bounds = Pick<PriceCheck, "lowestPriceCents" | "msrpCents">;

/** The USERS.md F1 messages for a price out of range. */
export function priceRangeMessage(code: "PRICE_BELOW_LOWEST" | "PRICE_ABOVE_RETAIL", bounds: Bounds): string {
  return code === "PRICE_BELOW_LOWEST"
    ? `The lowest price for this item is ${formatCents(bounds.lowestPriceCents)}. Below that you would lose money.`
    : `The highest price is the retail price, ${formatCents(bounds.msrpCents)}.`;
}
