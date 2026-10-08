// Product search on My store's catalog and a draft's Add list (L5): the
// typed text matches part of the name or brand, ignoring case.
import { describe, expect, it } from "vitest";
import { matchesProduct } from "@/shared/product-search";

const magnesium = { name: "Magnesium Glycinate", brand: "Designs for Health" };

describe("matchesProduct", () => {
  it("matches any part of the name or the brand, ignoring case and spaces around the text", () => {
    expect(matchesProduct(magnesium, "glycin")).toBe(true);
    expect(matchesProduct(magnesium, "  MAGNESIUM ")).toBe(true);
    expect(matchesProduct(magnesium, "designs")).toBe(true);
  });

  it("matches everything when nothing is typed, and nothing that doesn't fit", () => {
    expect(matchesProduct(magnesium, "")).toBe(true);
    expect(matchesProduct(magnesium, "   ")).toBe(true);
    expect(matchesProduct(magnesium, "omega")).toBe(false);
  });
});
