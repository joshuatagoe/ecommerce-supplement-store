// The fake login's session (ARCHITECTURE.md §10, D32): a JWT naming the
// provider, signed with HS256 and JWT_SECRET, carried in an HttpOnly cookie
// for 12 hours. Only HS256 is accepted, so an unsigned token or one signed
// with another algorithm never passes.
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "session";
export const SESSION_SECONDS = 12 * 60 * 60;

/** HttpOnly so scripts can't read it; Lax so it's sent when a link is followed. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_SECONDS,
} as const;

function keyFrom(secret: string): Uint8Array {
  // HS256 wants a key at least as long as its 256-bit output.
  if (secret.length < 32) throw new RangeError("JWT_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(providerId: string, secret: string, now = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(providerId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_SECONDS)
    .sign(keyFrom(secret));
}

/** The provider the token names, or null for any token that isn't one of ours and current. */
export async function verifySession(token: string, secret: string, now = new Date()): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), { algorithms: ["HS256"], currentDate: now });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
