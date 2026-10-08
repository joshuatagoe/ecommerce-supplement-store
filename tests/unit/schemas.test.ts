import { describe, expect, it } from "vitest";
import {
  REF_PATTERN,
  orderRefInput,
  parseInput,
  payInput,
  saveDraftInput,
  saveStoreItemInput,
  searchOrdersInput,
  searchPatientsInput,
  signInInput,
  startOrderInput,
} from "@/shared/schemas";

const item = "0199b0a0-0000-7000-8000-000000000001";
const other = "0199b0a0-0000-7000-8000-000000000002";
const ref = "K7Q2-M9XD";

function errorOf(result: ReturnType<typeof parseInput>) {
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.error;
}

describe("amounts are whole cents (§10: the server checks every input)", () => {
  it("accepts a whole number of cents", () => {
    expect(parseInput(saveStoreItemInput, { catalogItemId: item, usualPriceCents: 3600 })).toEqual({
      ok: true,
      data: { catalogItemId: item, usualPriceCents: 3600 },
    });
  });

  it.each([3600.5, "3600", -1, Number.NaN, null])("refuses %s as a price", (usualPriceCents) => {
    expect(errorOf(parseInput(saveStoreItemInput, { catalogItemId: item, usualPriceCents }))).toMatchObject({
      code: "INVALID_INPUT",
      field: "usualPriceCents",
    });
  });

  it("refuses an ID that isn't a UUID", () => {
    expect(errorOf(parseInput(signInInput, { providerId: "dr-rivera" }))).toMatchObject({
      code: "INVALID_INPUT",
      field: "providerId",
    });
  });
});

describe("saveDraft lines", () => {
  const line = { catalogItemId: item, quantity: 1, priceCents: 3600 };

  it("accepts a line with a price or with a margin", () => {
    const result = parseInput(saveDraftInput, {
      ref,
      lines: [line, { catalogItemId: other, quantity: 10, marginCents: 1573 }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an empty draft", () => {
    expect(parseInput(saveDraftInput, { ref, lines: [] }).ok).toBe(true);
  });

  it.each([0, 11, 2.5, -1])("refuses quantity %s as QUANTITY_OUT_OF_RANGE", (quantity) => {
    expect(errorOf(parseInput(saveDraftInput, { ref, lines: [{ ...line, quantity }] }))).toMatchObject({
      code: "QUANTITY_OUT_OF_RANGE",
      field: "lines.0.quantity",
    });
  });

  it("refuses a line with both a price and a margin, or neither", () => {
    expect(parseInput(saveDraftInput, { ref, lines: [{ ...line, marginCents: 1573 }] }).ok).toBe(false);
    expect(parseInput(saveDraftInput, { ref, lines: [{ catalogItemId: item, quantity: 1 }] }).ok).toBe(false);
  });

  it("refuses a negative margin", () => {
    expect(
      errorOf(parseInput(saveDraftInput, { ref, lines: [{ catalogItemId: item, quantity: 1, marginCents: -1 }] })),
    ).toMatchObject({ code: "INVALID_INPUT", field: "lines.0.marginCents" });
  });

  it("refuses the same product twice, because quantity covers it (§7)", () => {
    expect(errorOf(parseInput(saveDraftInput, { ref, lines: [line, { ...line, quantity: 2 }] }))).toMatchObject({
      code: "INVALID_INPUT",
      field: "lines",
    });
  });
});

describe("order refs (§6)", () => {
  it("accepts a ref from the link alphabet", () => {
    expect(REF_PATTERN.test(ref)).toBe(true);
    expect(parseInput(orderRefInput, { ref }).ok).toBe(true);
  });

  it.each(["K7Q2-M9X0", "K7Q2-M9XO", "K7Q2-M9X1", "K7Q2-M9XI", "K7Q2-M9XL", "k7q2-m9xd", "K7Q2M9XD", "K7Q2-M9XD2"])(
    "refuses %s",
    (bad) => {
      expect(REF_PATTERN.test(bad)).toBe(false);
      expect(parseInput(orderRefInput, { ref: bad }).ok).toBe(false);
    },
  );
});

describe("startOrder", () => {
  it("takes a patient or a past order, not both", () => {
    expect(parseInput(startOrderInput, { patientId: item }).ok).toBe(true);
    expect(parseInput(startOrderInput, { fromOrderRef: ref }).ok).toBe(true);
    expect(parseInput(startOrderInput, { patientId: item, fromOrderRef: ref }).ok).toBe(false);
    expect(parseInput(startOrderInput, {}).ok).toBe(false);
  });
});

describe("searches", () => {
  it("trims patient search text and caps its length", () => {
    expect(parseInput(searchPatientsInput, { text: "  sam " })).toEqual({ ok: true, data: { text: "sam" } });
    expect(parseInput(searchPatientsInput, { text: "x".repeat(101) }).ok).toBe(false);
  });

  it("filters Sales by display status, including Expired, and defaults the date field", () => {
    expect(parseInput(searchOrdersInput, { status: "expired" })).toEqual({
      ok: true,
      data: { status: "expired", dateField: "created" },
    });
    expect(parseInput(searchOrdersInput, { status: "bogus" }).ok).toBe(false);
    expect(parseInput(searchOrdersInput, { dateField: "paid", from: "2026-10-01", to: "2026-10-31" }).ok).toBe(true);
    expect(parseInput(searchOrdersInput, { from: "2026-10-32" }).ok).toBe(false);
  });

  it("takes a page number from the URL and a product by its ID (L5)", () => {
    expect(parseInput(searchOrdersInput, { page: "2" })).toEqual({ ok: true, data: { dateField: "created", page: 2 } });
    expect(parseInput(searchOrdersInput, { page: "0" }).ok).toBe(false);
    expect(parseInput(searchOrdersInput, { page: "two" }).ok).toBe(false);
    const product = "0199b0a0-0000-7000-8000-000000000001";
    expect(parseInput(searchOrdersInput, { product })).toEqual({ ok: true, data: { dateField: "created", product } });
    expect(parseInput(searchOrdersInput, { product: "magnesium" }).ok).toBe(false);
  });
});

describe("pay (§5: the browser never sends an amount)", () => {
  const october = new Date("2026-10-07T12:00:00Z");
  const pay = payInput(october);
  const card = { number: "4242 4242 4242 4242", expiry: "12/26", securityCode: "123", zip: "94110" };
  const valid = { token: `${ref}.AAAAAAAAAAAAAAAAAAAAAA`, payKey: item, card };

  it("accepts a card and keeps only the digits of its number", () => {
    const result = parseInput(pay, valid);
    expect(result.ok && result.data.card.number).toBe("4242424242424242");
  });

  it("refuses any amount the browser sends", () => {
    expect(parseInput(pay, { ...valid, amountCents: 1 }).ok).toBe(false);
  });

  it("accepts a card through the end of its expiry month, and refuses one already expired", () => {
    expect(parseInput(pay, { ...valid, card: { ...card, expiry: "10/26" } }).ok).toBe(true);
    expect(errorOf(parseInput(pay, { ...valid, card: { ...card, expiry: "09/26" } }))).toMatchObject({
      code: "INVALID_INPUT",
      field: "card.expiry",
      message: "This card has expired.",
    });
  });

  it.each([
    ["number", "4242 4242", "card.number"],
    ["expiry", "13/26", "card.expiry"],
    ["securityCode", "12", "card.securityCode"],
    ["zip", "9411", "card.zip"],
  ])("points a bad %s at its field", (key, value, field) => {
    expect(errorOf(parseInput(pay, { ...valid, card: { ...card, [key]: value } }))).toMatchObject({ field });
  });
});
