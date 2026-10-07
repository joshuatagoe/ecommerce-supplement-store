// Signed pay links (ARCHITECTURE.md §6, D25). A link is /pay/<ref>.<signature>,
// where the signature is HMAC-SHA256(LINK_SIGNING_KEY, "<ref>:<link_version>")
// cut to 128 bits. The database stores no secret: the same order and version
// always give the same link, and New link raises the version, which turns
// every older link off.
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { TOKEN_PATTERN } from "../../shared/schemas.ts";
import type { Db } from "../db/client.ts";
import { orders } from "../db/schema.ts";

function signatureBytes(key: string, ref: string, version: number): Buffer {
  if (key.length < 32) throw new RangeError("LINK_SIGNING_KEY must be at least 32 characters");
  return createHmac("sha256", key).update(`${ref}:${version}`).digest().subarray(0, 16);
}

export function linkSignature(key: string, ref: string, version: number): string {
  return signatureBytes(key, ref, version).toString("base64url");
}

export function linkToken(key: string, ref: string, version: number): string {
  return `${ref}.${linkSignature(key, ref, version)}`;
}

export function payLink(appUrl: string, key: string, ref: string, version: number): string {
  return `${appUrl.replace(/\/+$/, "")}/pay/${linkToken(key, ref, version)}`;
}

export function parseToken(token: string): { ref: string; signature: string } | null {
  const match = TOKEN_PATTERN.exec(token);
  return match ? { ref: match[1], signature: match[2] } : null;
}

/** Compared in constant time, so a near-miss takes as long to refuse as a wild guess. */
export function signatureMatches(key: string, ref: string, version: number, signature: string): boolean {
  const expected = signatureBytes(key, ref, version);
  const given = Buffer.from(signature, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type LinkedOrder = { id: string; ref: string; status: string; linkVersion: number };

/**
 * The one order a link opens, or null. Every failure looks the same (§6): a
 * made-up ref, a replaced link, a broken signature, an old key, or a draft,
 * which has no link yet.
 */
export async function orderForToken(db: Db, key: string, token: string): Promise<LinkedOrder | null> {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const [order] = await db
    .select({ id: orders.id, ref: orders.ref, status: orders.status, linkVersion: orders.linkVersion })
    .from(orders)
    .where(eq(orders.ref, parsed.ref));
  // Check a signature even when there's no order, so both take the same time.
  const version = order?.linkVersion ?? 0;
  const matches = signatureMatches(key, parsed.ref, version, parsed.signature);
  if (!order || order.linkVersion === null || !matches) return null;
  return { ...order, linkVersion: order.linkVersion };
}
