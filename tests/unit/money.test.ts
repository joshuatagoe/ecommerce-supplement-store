import { describe, expect, it } from "vitest";
import { formatCents, parseDollars, priceRangeMessage } from "@/shared/money";

describe("formatCents", () => {
  it.each([
    [3600, "$36.00"],
    [27, "$0.27"],
    [5, "$0.05"],
    [0, "$0.00"],
    [123456, "$1,234.56"],
    [-1, "−$0.01"],
    [-157300, "−$1,573.00"],
  ])("shows %i cents as %s", (cents, shown) => {
    expect(formatCents(cents)).toBe(shown);
  });
});

describe("parseDollars", () => {
  it.each([
    ["36", 3600],
    ["36.00", 3600],
    ["36.5", 3650],
    ["$36.01", 3601],
    [" 1,234.56 ", 123456],
    [".27", 27],
    ["0", 0],
  ])("reads %s as %i cents", (typed, cents) => {
    expect(parseDollars(typed)).toBe(cents);
  });

  it.each(["", "  ", "abc", "36.001", "-5", "36.0.0", "1e3", "$", "3 6"])("refuses %j", (typed) => {
    expect(parseDollars(typed)).toBeNull();
  });
});

describe("priceRangeMessage (USERS.md F1)", () => {
  const bounds = { lowestPriceCents: 2016, msrpCents: 4000 };

  it("explains a price below the lowest", () => {
    expect(priceRangeMessage("PRICE_BELOW_LOWEST", bounds)).toBe(
      "The lowest price for this item is $20.16. Below that you would lose money.",
    );
  });

  it("explains a price above retail", () => {
    expect(priceRangeMessage("PRICE_ABOVE_RETAIL", bounds)).toBe("The highest price is the retail price, $40.00.");
  });
});
