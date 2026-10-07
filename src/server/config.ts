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
  return whole("LINK_TTL_DAYS", 30);
}

/** The pause after typing before a draft saves itself (§9). */
export function autosaveDebounceMs(): number {
  return whole("AUTOSAVE_DEBOUNCE_MS", 1000);
}
