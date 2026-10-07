// PaymentGateway (ARCHITECTURE.md §3, §5): the payment company. Stubbed in the
// slice; a Stripe Connect-style charge plugs in here. Card details would go
// straight from the browser to the payment company in the real version.

export type Card = { number: string; expiry: string; securityCode: string; zip: string };

export type ChargeAnswer = { outcome: "approved"; chargeRef: string } | { outcome: "declined" };

export type LookupAnswer = { status: "charged"; chargeRef: string } | { status: "not_charged" };

export interface PaymentGateway {
  /**
   * Charges once per idempotency key: repeating a key returns the first answer
   * instead of charging again. It may never answer; the caller sets its own timeout.
   */
  charge(request: { idempotencyKey: string; amountCents: number; card: Card }): Promise<ChargeAnswer>;
  /** Asks what happened to a charge, without making one. Throws when it can't tell. */
  lookup(idempotencyKey: string): Promise<LookupAnswer>;
  /** Stub mode only: whether a card number is one of the test cards. */
  acceptsCard?(cardNumber: string): boolean;
}
