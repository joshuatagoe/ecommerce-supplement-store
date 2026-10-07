// Signed pay links (ARCHITECTURE.md §6, D25): HMAC-SHA256 of "<ref>:<version>",
// cut to 128 bits and base64url-encoded. The database stores no secret.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { linkSignature, linkToken, parseToken, payLink, signatureMatches } from "@/server/links";
import { newRef } from "@/server/orders/refs";
import { REF_PATTERN, TOKEN_PATTERN } from "@/shared/schemas";

const key = "link-signing-key-that-is-at-least-32-chars";
const ref = "K7Q2-M9XD";

describe("link signatures", () => {
  it("is the first 128 bits of HMAC-SHA256(key, ref:version), base64url", () => {
    const expected = createHmac("sha256", key).update(`${ref}:1`).digest().subarray(0, 16).toString("base64url");
    expect(linkSignature(key, ref, 1)).toBe(expected);
    expect(expected).toHaveLength(22);
  });

  it("gives the same order and version the same link, so a double-clicked Send returns one link", () => {
    expect(linkToken(key, ref, 1)).toBe(linkToken(key, ref, 1));
    expect(TOKEN_PATTERN.test(linkToken(key, ref, 1))).toBe(true);
    expect(payLink("https://store.test", key, ref, 1)).toBe(`https://store.test/pay/${linkToken(key, ref, 1)}`);
  });

  it("changes when New link raises the version, or the key changes", () => {
    expect(linkSignature(key, ref, 2)).not.toBe(linkSignature(key, ref, 1));
    expect(linkSignature(`${key}-rotated`, ref, 1)).not.toBe(linkSignature(key, ref, 1));
  });

  it("matches only the current version's signature", () => {
    const old = linkSignature(key, ref, 1);
    expect(signatureMatches(key, ref, 1, old)).toBe(true);
    expect(signatureMatches(key, ref, 2, old)).toBe(false);
    expect(signatureMatches(key, ref, 1, `${old.slice(0, -1)}${old.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(signatureMatches(key, ref, 1, "short")).toBe(false);
  });

  it("refuses a short key", () => {
    expect(() => linkSignature("short", ref, 1)).toThrow(RangeError);
  });
});

describe("parseToken", () => {
  it("splits a token into the ref and the signature", () => {
    const token = linkToken(key, ref, 3);
    expect(parseToken(token)).toEqual({ ref, signature: token.split(".")[1] });
  });

  it.each(["", "K7Q2-M9XD", "K7Q2-M9XD.", "k7q2-m9xd.AAAAAAAAAAAAAAAAAAAAAA", "K7Q2-M9XD.AAAA", "../etc/passwd"])(
    "refuses %j",
    (token) => {
      expect(parseToken(token)).toBeNull();
    },
  );
});

describe("order refs (§6)", () => {
  it("are 8 characters from the link alphabet, in two groups of four", () => {
    const refs = Array.from({ length: 2000 }, () => newRef());
    for (const made of refs) expect(made).toMatch(REF_PATTERN);
    // 31^8 possibilities: 2,000 refs shouldn't repeat.
    expect(new Set(refs).size).toBe(refs.length);
  });
});
