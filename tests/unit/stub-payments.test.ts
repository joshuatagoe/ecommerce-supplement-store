// The stub payment company (ARCHITECTURE.md §5 "Test cards", D38). It keeps
// its own records in a file, so stopping our database doesn't wipe its memory,
// and it answers each idempotency key once, the way Stripe does.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stubPayments, TEST_CARDS } from "@/server/adapters/stub-payments";

const card = (number: string) => ({ number, expiry: "12/30", securityCode: "123", zip: "94110" });

function stub(options: { slowApproveMs?: number; silenceMs?: number } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "stub-")), "stub-payments.json");
  return { path, gateway: stubPayments({ path, slowApproveMs: options.slowApproveMs ?? 50, silenceMs: options.silenceMs ?? 300 }) };
}

/** Resolves with the answer, or "silent" if none comes within the wait. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | "silent"> {
  return Promise.race([promise, new Promise<"silent">((resolve) => setTimeout(() => resolve("silent"), ms))]);
}

describe("test cards", () => {
  it("are exactly the five in §5", () => {
    expect(Object.keys(TEST_CARDS).sort()).toEqual(
      ["4000000000000002", "4000000000000101", "4000000000000200", "4000000000000309", "4242424242424242"].sort(),
    );
  });

  it("4242 approves at once", async () => {
    const { gateway } = stub();
    const key = randomUUID();
    const answer = await gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4242424242424242") });
    expect(answer).toEqual({ outcome: "approved", chargeRef: expect.stringMatching(/^ch_/) });
    expect(await gateway.lookup(key)).toEqual({ status: "charged", chargeRef: (answer as { chargeRef: string }).chargeRef });
  });

  it("0002 declines at once, and nothing is charged", async () => {
    const { gateway } = stub();
    const key = randomUUID();
    expect(await gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4000000000000002") })).toEqual({
      outcome: "declined",
    });
    expect(await gateway.lookup(key)).toEqual({ status: "not_charged" });
  });

  it("0101 charges, then stays silent past our timeout", async () => {
    const { gateway } = stub({ silenceMs: 400 });
    const key = randomUUID();
    expect(await within(gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4000000000000101") }), 100)).toBe(
      "silent",
    );
    expect(await gateway.lookup(key)).toEqual({ status: "charged", chargeRef: expect.stringMatching(/^ch_/) });
  });

  it("0200 stays silent and doesn't charge", async () => {
    const { gateway } = stub({ silenceMs: 400 });
    const key = randomUUID();
    expect(await within(gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4000000000000200") }), 100)).toBe(
      "silent",
    );
    expect(await gateway.lookup(key)).toEqual({ status: "not_charged" });
  });

  it("0309 charges, waits, then approves", async () => {
    const { gateway } = stub({ slowApproveMs: 150 });
    const key = randomUUID();
    const pending = gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4000000000000309") });
    expect(await within(pending, 50)).toBe("silent");
    // Charged before it answers, so a lookup during the pause already finds it.
    expect(await gateway.lookup(key)).toMatchObject({ status: "charged" });
    expect(await pending).toEqual({ outcome: "approved", chargeRef: expect.stringMatching(/^ch_/) });
  });

  it("knows only its test cards", () => {
    const { gateway } = stub();
    expect(gateway.acceptsCard?.("4242424242424242")).toBe(true);
    expect(gateway.acceptsCard?.("4111111111111111")).toBe(false);
  });
});

describe("idempotency (§5 step 4)", () => {
  it("answers a repeated key with the first answer and never charges twice", async () => {
    const { gateway } = stub();
    const key = randomUUID();
    const first = await gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4242424242424242") });
    const again = await gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4242424242424242") });
    expect(again).toEqual(first);
    expect(gateway.chargeCount()).toBe(1);
  });

  it("answers a key it has never seen as not charged", async () => {
    const { gateway } = stub();
    expect(await gateway.lookup(randomUUID())).toEqual({ status: "not_charged" });
  });
});

describe("its own file", () => {
  it("remembers charges across restarts, apart from our database", async () => {
    const { path, gateway } = stub();
    const key = randomUUID();
    const answer = await gateway.charge({ idempotencyKey: key, amountCents: 3600, card: card("4242424242424242") });
    const restarted = stubPayments({ path, slowApproveMs: 50, silenceMs: 300 });
    expect(await restarted.lookup(key)).toEqual({ status: "charged", chargeRef: (answer as { chargeRef: string }).chargeRef });
  });
});
