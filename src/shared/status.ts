// Order statuses and what each one shows (ARCHITECTURE.md §4, §6, §8). Shared
// by the portal, the pay page and the server, so the words and the rules that
// pick them live in one place. The database stores five statuses; Expired and
// "payment in progress" are worked out, never stored (D26).

export const ORDER_STATUSES = ["draft", "sent", "needs_review", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ATTEMPT_STATUSES = ["pending", "succeeded", "declined", "failed"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const DISPLAY_STATUSES = ["draft", "sent", "expired", "needs_review", "paid", "cancelled"] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/** The only place a status becomes a word. Each is shown with an icon, never by colour alone (§9). */
export const STATUS_WORDS: Record<DisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  expired: "Expired",
  needs_review: "Needs review",
  paid: "Paid",
  cancelled: "Cancelled",
};

export type SalesAction = "continue" | "discard_draft" | "copy_link" | "new_link" | "cancel_order" | "order_again";

/** One verb per action, used on the button and in its confirmation (§4). */
export const ACTION_LABELS: Record<SalesAction, string> = {
  continue: "Continue",
  discard_draft: "Discard draft",
  copy_link: "Copy link",
  new_link: "New link",
  cancel_order: "Cancel order",
  order_again: "Order again",
};

export type PayPageState = "checkout" | "confirming" | "paid" | "cancelled" | "expired" | "invalid";

/** What a status needs: the stored status, the link expiry, and whether an attempt is pending. */
export type OrderState = { status: OrderStatus; linkExpiresAt: Date | null; paymentInProgress: boolean };

function linkExpired(order: OrderState, now: Date): boolean {
  return order.linkExpiresAt !== null && order.linkExpiresAt.getTime() <= now.getTime();
}

/** Expired is a sent order whose link expiry has passed (§4). */
export function displayStatus(order: OrderState, now: Date): DisplayStatus {
  if (order.status === "sent" && linkExpired(order, now)) return "expired";
  return order.status;
}

/** The actions the Sales list offers (§8). New link and Cancel order wait while a payment is in progress (D26). */
export function salesActions(order: OrderState, now: Date): SalesAction[] {
  const status = displayStatus(order, now);
  if (order.paymentInProgress) return status === "sent" ? ["copy_link"] : [];
  switch (status) {
    case "draft":
      return ["continue", "discard_draft"];
    case "sent":
      return ["copy_link", "new_link", "cancel_order"];
    case "expired":
      return ["new_link", "cancel_order"];
    case "needs_review":
      return [];
    case "paid":
    case "cancelled":
      return ["order_again"];
  }
}

/**
 * The pay page for a link whose signature passed (§6). A payment already in
 * progress still settles after the link expires, so confirming wins over
 * expired. A draft has no link, so it reads as invalid.
 */
export function payPageState(order: OrderState, now: Date): PayPageState {
  switch (order.status) {
    case "draft":
      return "invalid";
    case "needs_review":
      return "confirming";
    case "paid":
      return "paid";
    case "cancelled":
      return "cancelled";
    case "sent":
      if (order.paymentInProgress) return "confirming";
      return linkExpired(order, now) ? "expired" : "checkout";
  }
}
