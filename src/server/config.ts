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
