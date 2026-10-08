// Settings from the environment (ARCHITECTURE.md §14). Read when used, not at
// import, so tests and scripts can set them first.

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError(`${name} must be a whole number, not ${value}`);
  return parsed;
}

/** The fee rate copied onto each order at Send (D1, D17). */
export function feeRateBps(): number {
  return whole("FEE_RATE_BPS", 75);
}

/** Signs provider sessions (D32). Never committed; `.env.example` has a local-only value. */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

/** Signs pay links (D25). Changing it turns off every live link. */
export function linkSigningKey(): string {
  const key = process.env.LINK_SIGNING_KEY;
  if (!key) throw new Error("LINK_SIGNING_KEY is not set");
  return key;
}

/** Where pay links point: the site's own address. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

/** How long a pay link can start a payment (§6). */
export function linkTtlDays(): number {
  return whole("LINK_TTL_DAYS", 90);
}

/** The pause after typing before a draft saves itself (§9). */
export function autosaveDebounceMs(): number {
  return whole("AUTOSAVE_DEBOUNCE_MS", 1000);
}

/** Which payment company: the stub with its test cards, or (later) Stripe. */
export function paymentsMode(): "stub" | "stripe" {
  return process.env.PAYMENTS_MODE === "stripe" ? "stripe" : "stub";
}

/** How long Pay waits for the payment company before showing "confirming" (§5). */
export function paymentTimeoutMs(): number {
  return whole("PAYMENT_TIMEOUT_MS", 10_000);
}

/** How often the sweep runs. It also runs once at server start. */
export function sweepEveryMs(): number {
  return whole("SWEEP_EVERY_MS", 5_000);
}

/** How long an attempt may stay pending before the sweep asks about it; longer than the payment timeout. */
export function sweepAfterMs(): number {
  return whole("SWEEP_AFTER_MS", 15_000);
}

/** The stub's pause before approving card 0309; shorter than the payment timeout. */
export function stubSlowApproveMs(): number {
  return whole("STUB_SLOW_APPROVE_MS", 7_000);
}

/** Where the stub payment company keeps its records, apart from our database. */
export function stubStorePath(): string {
  return process.env.STUB_STORE_PATH || ".data/stub-payments.json";
}

/** The confirming page's stream: a heartbeat, and how long before it closes (§5). */
export function sseHeartbeatMs(): number {
  return whole("SSE_HEARTBEAT_MS", 15_000);
}

export function sseMaxMs(): number {
  return whole("SSE_MAX_MS", 300_000);
}
