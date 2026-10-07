import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  DISPLAY_STATUSES,
  ORDER_STATUSES,
  STATUS_WORDS,
  displayStatus,
  payPageState,
  salesActions,
  type OrderStatus,
} from "@/shared/status";

const now = new Date("2026-10-07T12:00:00Z");
const later = new Date("2026-11-06T12:00:00Z");
const earlier = new Date("2026-10-07T11:59:59Z");

function order(status: OrderStatus, linkExpiresAt: Date | null = null, paymentInProgress = false) {
  return { status, linkExpiresAt, paymentInProgress };
}

describe("displayStatus", () => {
  it("keeps a sent order Sent until its link expires", () => {
    expect(displayStatus(order("sent", later), now)).toBe("sent");
  });

  it("shows Expired from the moment the link expires", () => {
    expect(displayStatus(order("sent", now), now)).toBe("expired");
    expect(displayStatus(order("sent", earlier), now)).toBe("expired");
  });

  it("never shows Expired for an order that has left sent", () => {
    expect(displayStatus(order("needs_review", earlier), now)).toBe("needs_review");
    expect(displayStatus(order("paid", earlier), now)).toBe("paid");
    expect(displayStatus(order("cancelled", earlier), now)).toBe("cancelled");
  });

  it("passes a draft through", () => {
    expect(displayStatus(order("draft"), now)).toBe("draft");
  });
});

describe("salesActions (ARCHITECTURE.md §8)", () => {
  it("gives each status its actions", () => {
    expect(salesActions(order("draft"), now)).toEqual(["continue", "discard_draft"]);
    expect(salesActions(order("sent", later), now)).toEqual(["copy_link", "new_link", "cancel_order"]);
    expect(salesActions(order("sent", earlier), now)).toEqual(["new_link", "cancel_order"]);
    expect(salesActions(order("needs_review", later), now)).toEqual([]);
    expect(salesActions(order("paid", later), now)).toEqual(["order_again"]);
    expect(salesActions(order("cancelled", later), now)).toEqual(["order_again"]);
  });

  it("offers no New link or Cancel order while a payment is in progress", () => {
    expect(salesActions(order("sent", later, true), now)).toEqual(["copy_link"]);
    expect(salesActions(order("sent", earlier, true), now)).toEqual([]);
  });
});

describe("payPageState (ARCHITECTURE.md §6)", () => {
  it("shows checkout for a sent order with a live link and no payment under way", () => {
    expect(payPageState(order("sent", later), now)).toBe("checkout");
  });

  it("shows confirming while a payment is in progress, even past expiry", () => {
    expect(payPageState(order("sent", later, true), now)).toBe("confirming");
    expect(payPageState(order("sent", earlier, true), now)).toBe("confirming");
    expect(payPageState(order("needs_review", earlier), now)).toBe("confirming");
  });

  it("shows paid, cancelled and expired", () => {
    expect(payPageState(order("paid", earlier), now)).toBe("paid");
    expect(payPageState(order("cancelled", later), now)).toBe("cancelled");
    expect(payPageState(order("sent", now), now)).toBe("expired");
  });

  it("treats a draft as an invalid link, because a draft has no link", () => {
    expect(payPageState(order("draft"), now)).toBe("invalid");
  });
});

describe("words", () => {
  it("has a word for every display status, and every display status comes from a stored one", () => {
    expect(Object.keys(STATUS_WORDS).sort()).toEqual([...DISPLAY_STATUSES].sort());
    expect(STATUS_WORDS).toMatchObject({ needs_review: "Needs review", expired: "Expired" });
    expect(DISPLAY_STATUSES).toEqual(expect.arrayContaining([...ORDER_STATUSES]));
  });

  it("keeps one verb per action (§4)", () => {
    expect(ACTION_LABELS).toEqual({
      continue: "Continue",
      discard_draft: "Discard draft",
      copy_link: "Copy link",
      new_link: "New link",
      cancel_order: "Cancel order",
      order_again: "Order again",
    });
  });
});
