// The fake login's session token (ARCHITECTURE.md §10, D32): a JWT signed
// with HS256 and nothing else, valid for 12 hours.
import { SignJWT, UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/server/access/session";

const secret = "test-secret-that-is-at-least-32-characters-long";
const provider = "0199b0a0-0000-7000-8000-000000000001";
const now = new Date("2026-10-07T12:00:00Z");
const key = new TextEncoder().encode(secret);

describe("session tokens", () => {
  it("names the provider who signed in", async () => {
    const token = await signSession(provider, secret, now);
    expect(await verifySession(token, secret, now)).toBe(provider);
  });

  it("lasts 12 hours, and not a second longer", async () => {
    const token = await signSession(provider, secret, now);
    const almost = new Date(now.getTime() + 12 * 3600_000 - 1000);
    const after = new Date(now.getTime() + 12 * 3600_000 + 1000);
    expect(await verifySession(token, secret, almost)).toBe(provider);
    expect(await verifySession(token, secret, after)).toBeNull();
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signSession(provider, "another-secret-that-is-also-32-characters", now);
    expect(await verifySession(token, secret, now)).toBeNull();
  });

  it("refuses an unsigned token (alg: none)", async () => {
    const token = new UnsecuredJWT({ sub: provider }).setIssuedAt(now).setExpirationTime("12h").encode();
    expect(await verifySession(token, secret, now)).toBeNull();
  });

  it("refuses a token signed with any algorithm but HS256", async () => {
    const token = await new SignJWT({ sub: provider })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 3600)
      .sign(key);
    expect(await verifySession(token, secret, now)).toBeNull();
  });

  it("refuses a token whose provider was edited", async () => {
    const token = await signSession(provider, secret, now);
    const [header, , signature] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ sub: "0199b0a0-0000-7000-8000-000000000002" })).toString("base64url");
    expect(await verifySession(`${header}.${edited}.${signature}`, secret, now)).toBeNull();
  });

  it("refuses rubbish and a token with no provider", async () => {
    expect(await verifySession("not-a-token", secret, now)).toBeNull();
    const noSubject = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 3600)
      .sign(key);
    expect(await verifySession(noSubject, secret, now)).toBeNull();
  });

  it("refuses a short secret, so a weak key can't sign in production", async () => {
    await expect(signSession(provider, "short", now)).rejects.toThrow(RangeError);
  });
});
