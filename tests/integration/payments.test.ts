// The Pay flow against real Postgres (ARCHITECTURE.md §5, F3): every row of the
// "breaks" table, the three guards against a double charge, and the sweep.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logInventory } from "@/server/adapters/log-inventory";
import { logLinkSender } from "@/server/adapters/log-link-sender";
import { stubPayments } from "@/server/adapters/stub-payments";
import * as schema from "@/server/db/schema";
import { cancelOrder, type OrdersContext, saveDraft, sendOrder, startOrder } from "@/server/orders";
import { pay, type PaymentsContext, payPage, sweep } from "@/server/payments";
import type { PaymentGateway } from "@/server/ports/payment-gateway";
import { makeClinic, type Scratch, scratchDatabase, type TestClinic } from "./scratch";

const KEY = "link-signing-key-that-is-at-least-32-chars";
const MINUTE = 60_000;
const card = (number = "4242424242424242") => ({ number, expiry: "12/30", securityCode: "123", zip: "94110" });
let scratch: Scratch;

beforeAll(async () => {
  scratch = await scratchDatabase("payments");
}, 30_000);
afterAll(() => scratch?.drop());

function stub(options: { slowApproveMs?: number; silenceMs?: number } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "stub-")), "stub-payments.json");
  return stubPayments({ path, slowApproveMs: options.slowApproveMs ?? 50, silenceMs: options.silenceMs ?? 2_000 });
}

function payments(gateway: PaymentGateway, extra: Partial<PaymentsContext> = {}): PaymentsContext {
  return {
    db: scratch.db,
    now: () => new Date(),
    gateway,
    paymentTimeoutMs: 300,
    sweepAfterMs: 15_000,
    linkSigningKey: KEY,
    inventory: logInventory,
    ...extra,
  };
}

/**
 * A sweep that runs a minute from now, so every attempt made in the test counts
 * as stuck. The sweep checks every stuck attempt in the database, other tests'
 * included, so tests check their own order's state rather than its counts.
 */
function later(ctx: PaymentsContext): PaymentsContext {
  return { ...ctx, now: () => new Date(Date.now() + MINUTE) };
}

function orders(now = new Date()): OrdersContext {
  return {
    db: scratch.db,
    now: () => now,
    feeRateBps: 75,
    linkSigningKey: KEY,
    appUrl: "https://store.test",
    linkTtlDays: 30,
    linkSender: logLinkSender,
  };
}

/** Sam's order of one Magnesium Glycinate at $36.00, sent; returns its ref and link token. */
async function sentOrder(clinic: TestClinic, sentAt = new Date()): Promise<{ ref: string; token: string }> {
  const started = await startOrder(orders(sentAt), clinic.provider, { patientId: clinic.patientId });
  if (!started.ok) throw new Error(started.error.message);
  await saveDraft(orders(sentAt), clinic.provider, {
    ref: started.ref,
    lines: [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 }],
  });
  const sent = await sendOrder(orders(sentAt), clinic.provider, started.ref);
  if (!sent.ok) throw new Error(sent.error.message);
  return { ref: started.ref, token: sent.link.split("/pay/")[1] };
}

async function order(ref: string) {
  return (await scratch.pool.query("SELECT id, status, paid_attempt_id, paid_at FROM orders WHERE ref = $1", [ref])).rows[0];
}

async function attempts(ref: string) {
  const { rows } = await scratch.pool.query(
    `SELECT a.id, a.status, a.amount_cents, a.charge_ref, a.settled_by, a.idempotency_key
       FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.ref = $1 ORDER BY a.created_at, a.id`,
    [ref],
  );
  return rows;
}

async function events(ref: string): Promise<string[]> {
  const { rows } = await scratch.pool.query(
    "SELECT e.kind FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.ref = $1 ORDER BY e.at, e.id",
    [ref],
  );
  return rows.map((row) => row.kind);
}

/** A payment company we control: it counts charges, and can answer, decline, or never answer. */
function fakeGateway(answer: "approve" | "decline" | "silent" = "approve") {
  const charged = new Map<string, string>();
  let calls = 0;
  const gateway: PaymentGateway & { calls: () => number } = {
    calls: () => calls,
    async charge({ idempotencyKey }) {
      calls += 1;
      if (answer === "decline") return { outcome: "declined" };
      const chargeRef = charged.get(idempotencyKey) ?? `ch_${randomUUID().slice(0, 8)}`;
      charged.set(idempotencyKey, chargeRef);
      if (answer === "silent") return new Promise(() => {});
      return { outcome: "approved", chargeRef };
    },
    async lookup(idempotencyKey) {
      const chargeRef = charged.get(idempotencyKey);
      return chargeRef ? { status: "charged", chargeRef } : { status: "not_charged" };
    },
  };
  return gateway;
}

describe("pay: the normal path", () => {
  it("charges the order's total, records the payment, and marks the order paid", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const gateway = stub();
    expect(await pay(payments(gateway), { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "paid" });

    const [attempt] = await attempts(ref);
    expect(attempt).toMatchObject({ status: "succeeded", amount_cents: 3600, settled_by: "request", charge_ref: expect.stringMatching(/^ch_/) });
    expect(await order(ref)).toMatchObject({ status: "paid", paid_attempt_id: attempt.id });
    expect(await events(ref)).toContain("paid");
    expect(gateway.chargeCount()).toBe(1);
  });

  it("pays normally when the approval is slow but inside the timeout (0309)", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub({ slowApproveMs: 100 }), { paymentTimeoutMs: 1_000 });
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000309") })).toEqual({ ok: true, outcome: "paid" });
    expect((await order(ref)).status).toBe("paid");
  });
});

describe("every place it can break (§5)", () => {
  it("steps 2–3, database down: nothing is charged, and the patient is told so", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { token } = await sentOrder(clinic);
    const down = new pg.Pool({ connectionString: "postgres://store:store@127.0.0.1:1/none", connectionTimeoutMillis: 300 });
    const gateway = fakeGateway();
    try {
      const result = await pay(payments(gateway, { db: drizzle(down, { schema }) }), { token, payKey: randomUUID(), card: card() });
      expect(result).toEqual({ ok: true, outcome: "not_charged" });
      expect(gateway.calls()).toBe(0);
    } finally {
      await down.end();
    }
  });

  it("between steps 3 and 4, a crash: the sweep finds no charge, fails the attempt, and Sam can pay again", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    // The attempt was saved, then the server died before charging.
    await scratch.pool.query(
      "INSERT INTO payment_attempts (order_id, idempotency_key, amount_cents, status) SELECT id, $2, 3600, 'pending' FROM orders WHERE ref = $1",
      [ref, randomUUID()],
    );
    const gateway = stub();
    const ctx = payments(gateway);
    // Another try meanwhile is told a payment is in progress, and never reaches the payment company.
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "in_progress" });
    expect(gateway.chargeCount()).toBe(0);

    await sweep(later(ctx));
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "failed", settled_by: "sweep" })]);
    expect((await order(ref)).status).toBe("sent");

    expect(await pay(ctx, { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "paid" });
  });

  it("step 4, declined: nothing is charged, the order stays sent, and a new Pay key can pay", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub());
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000002") })).toEqual({ ok: true, outcome: "declined" });
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "declined", settled_by: "request" })]);
    expect((await order(ref)).status).toBe("sent");
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "paid" });
  });

  it("step 4, no answer but charged (0101): confirming, needs review, and the sweep records the payment", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub({ silenceMs: 5_000 }), { paymentTimeoutMs: 150 });
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000101") })).toEqual({ ok: true, outcome: "confirming" });
    expect((await order(ref)).status).toBe("needs_review");
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "pending" })]);

    await sweep(later(ctx));
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "succeeded", settled_by: "sweep" })]);
    expect((await order(ref)).status).toBe("paid");
    expect(await events(ref)).toEqual(expect.arrayContaining(["needs_review", "paid"]));
  });

  it("step 4, no answer and not charged (0200): the sweep fails the attempt and the order goes back to sent", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub({ silenceMs: 5_000 }), { paymentTimeoutMs: 150 });
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000200") })).toEqual({ ok: true, outcome: "confirming" });
    expect((await order(ref)).status).toBe("needs_review");

    await sweep(later(ctx));
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "failed", settled_by: "sweep" })]);
    expect((await order(ref)).status).toBe("sent");
    expect(await pay(ctx, { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "paid" });
  });

  it("step 5 fails after the approval: confirming, and the sweep finds the charge", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const gateway = stub();
    const failing = payments(gateway, {
      hooks: {
        beforeRecordSuccess: async () => {
          throw new Error("the database went away");
        },
      },
    });
    expect(await pay(failing, { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "confirming" });
    // The money was taken, but nothing says so yet.
    expect(gateway.chargeCount()).toBe(1);
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "pending" })]);
    expect((await order(ref)).status).toBe("sent");

    await sweep(later(payments(gateway)));
    expect((await order(ref)).status).toBe("paid");
    expect(gateway.chargeCount()).toBe(1);
  });

  it("step 6, the reply is lost: paying again with the same Pay key returns paid, with one charge", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { token } = await sentOrder(clinic);
    const gateway = stub();
    const payKey = randomUUID();
    expect(await pay(payments(gateway), { token, payKey, card: card() })).toEqual({ ok: true, outcome: "paid" });
    expect(await pay(payments(gateway), { token, payKey, card: card() })).toEqual({ ok: true, outcome: "paid" });
    expect(gateway.chargeCount()).toBe(1);
  });
});

describe("three guards against a double charge (§5)", () => {
  it("50 Pays at once on one order, mixing repeated and new Pay keys, charge exactly once", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const gateway = stub();
    const keys = Array.from({ length: 10 }, () => randomUUID());
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => pay(payments(gateway), { token, payKey: keys[i % 10], card: card() })),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.some((result) => result.ok && result.outcome === "paid")).toBe(true);
    expect(gateway.chargeCount()).toBe(1);
    expect((await attempts(ref)).filter((a) => a.status === "succeeded")).toHaveLength(1);
    expect((await order(ref)).status).toBe("paid");
  });

  it("Cancel order and Pay at the same moment never leave a paid, cancelled order", async () => {
    const clinic = await makeClinic(scratch.pool);
    for (let i = 0; i < 8; i++) {
      const { ref, token } = await sentOrder(clinic);
      const gateway = stub();
      const [cancelled, paid] = await Promise.all([
        cancelOrder(orders(), clinic.provider, ref),
        pay(payments(gateway), { token, payKey: randomUUID(), card: card() }),
      ]);
      const status = (await order(ref)).status;
      if (status === "cancelled") {
        expect(cancelled.ok).toBe(true);
        expect(paid).toEqual({ ok: true, outcome: "not_charged" });
        expect(gateway.chargeCount()).toBe(0);
      } else {
        expect(status).toBe("paid");
        expect(cancelled.ok).toBe(false);
        expect(gateway.chargeCount()).toBe(1);
      }
    }
  });
});

describe("inventory: what sold, told once per paid order (L6, PRD requirement 5)", () => {
  async function inventoryUpdates(ref: string) {
    const { rows } = await scratch.pool.query(
      "SELECT e.details FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.ref = $1 AND e.kind = 'inventory_updated'",
      [ref],
    );
    return rows.map((row) => row.details);
  }

  /** Two Magnesium and one Omega, sent. */
  async function mixedOrder(clinic: TestClinic) {
    const started = await startOrder(orders(), clinic.provider, { patientId: clinic.patientId });
    if (!started.ok) throw new Error(started.error.message);
    await saveDraft(orders(), clinic.provider, {
      ref: started.ref,
      lines: [
        { catalogItemId: clinic.magnesiumId, quantity: 2, priceCents: 3600 },
        { catalogItemId: clinic.omegaId, quantity: 1, priceCents: 2700 },
      ],
    });
    const sent = await sendOrder(orders(), clinic.provider, started.ref);
    if (!sent.ok) throw new Error(sent.error.message);
    return { ref: started.ref, token: sent.link.split("/pay/")[1] };
  }

  it("tells inventory each product and quantity when Pay marks the order paid", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await mixedOrder(clinic);
    expect(await pay(payments(stub()), { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "paid" });
    const [update, ...more] = await inventoryUpdates(ref);
    expect(more).toEqual([]);
    expect(update.items).toEqual([
      { name: expect.stringMatching(/^Magnesium Glycinate/), quantity: 2 },
      { name: expect.stringMatching(/^Ultimate Omega/), quantity: 1 },
    ]);
  });

  it("tells inventory once when the sweep records the payment, however often the sweep runs (0101)", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub({ silenceMs: 5_000 }), { paymentTimeoutMs: 150 });
    await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000101") });
    expect(await inventoryUpdates(ref)).toEqual([]);
    await sweep(later(ctx));
    await sweep(later(ctx));
    expect((await order(ref)).status).toBe("paid");
    expect(await inventoryUpdates(ref)).toHaveLength(1);
  });

  it("tells inventory once when Pay and the sweep race to record the same charge", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const gateway = stub();
    // The sweep records the approval first; Pay's own write then finds it done and changes nothing.
    const racing = payments(gateway, { hooks: { beforeRecordSuccess: async () => void (await sweep(later(payments(gateway)))) } });
    expect((await pay(racing, { token, payKey: randomUUID(), card: card() })).ok).toBe(true);
    expect((await order(ref)).status).toBe("paid");
    expect(gateway.chargeCount()).toBe(1);
    expect(await inventoryUpdates(ref)).toHaveLength(1);
  });

  it("tells inventory nothing when the card is declined", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    await pay(payments(stub()), { token, payKey: randomUUID(), card: card("4000000000000002") });
    expect((await order(ref)).status).toBe("sent");
    expect(await inventoryUpdates(ref)).toEqual([]);
  });
});

describe("refusals", () => {
  it("refuses a link that isn't valid, without saying whether the order exists", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    const gateway = fakeGateway();
    for (const token of [`${ref}.AAAAAAAAAAAAAAAAAAAAAA`, "ZZZZ-ZZZZ.AAAAAAAAAAAAAAAAAAAAAA"]) {
      expect(await pay(payments(gateway), { token, payKey: randomUUID(), card: card() })).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    }
    expect(gateway.calls()).toBe(0);
  });

  it("doesn't start a payment once the link has expired", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic, new Date(Date.now() - 31 * 24 * MINUTE * 60));
    const gateway = fakeGateway();
    expect(await pay(payments(gateway), { token, payKey: randomUUID(), card: card() })).toEqual({ ok: true, outcome: "not_charged" });
    expect(gateway.calls()).toBe(0);
    expect(await attempts(ref)).toEqual([]);
  });

  it("refuses a card that isn't one of the test cards, in stub mode", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { token } = await sentOrder(clinic);
    expect(await pay(payments(stub()), { token, payKey: randomUUID(), card: card("4111111111111111") })).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "card.number", message: "Use one of the test cards listed below." },
    });
  });
});

describe("the sweep", () => {
  it("leaves an attempt alone until it has been pending longer than the sweep allows", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const ctx = payments(stub({ silenceMs: 5_000 }), { paymentTimeoutMs: 100 });
    await pay(ctx, { token, payKey: randomUUID(), card: card("4000000000000101") });
    await sweep(ctx);
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("keeps the order in needs review when the payment company can't say", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const silent = fakeGateway("silent");
    await pay(payments(silent, { paymentTimeoutMs: 100 }), { token, payKey: randomUUID(), card: card() });
    const unsure: PaymentGateway = {
      charge: silent.charge,
      lookup: async () => {
        throw new Error("the payment company is down");
      },
    };
    expect((await sweep(later(payments(unsure)))).unresolved).toBeGreaterThanOrEqual(1);
    expect((await order(ref)).status).toBe("needs_review");
    expect(await attempts(ref)).toEqual([expect.objectContaining({ status: "pending" })]);
  });
});

describe("payPage (§6: what a link shows)", () => {
  it("shows checkout with the provider, the items, retail prices and the total, but no patient name", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, token } = await sentOrder(clinic);
    const page = await payPage(payments(stub()), token);
    expect(page).toMatchObject({
      ref,
      state: "checkout",
      providerName: "Dr. Rivera",
      practiceName: expect.stringMatching(/^Lakeview/),
      totalCents: 3600,
      savingsCents: 400,
      lines: [{ productName: expect.stringMatching(/^Magnesium Glycinate .+, 120 capsules$/), quantity: 1, unitPriceCents: 3600, unitMsrpCents: 4000 }],
    });
    expect(JSON.stringify(page)).not.toMatch(/Sam|Okafor/);
  });

  it("shows each state the order can be in", async () => {
    const clinic = await makeClinic(scratch.pool);
    const gateway = stub({ silenceMs: 5_000 });

    const paid = await sentOrder(clinic);
    await pay(payments(gateway), { token: paid.token, payKey: randomUUID(), card: card() });
    expect(await payPage(payments(gateway), paid.token)).toMatchObject({ state: "paid", paidAt: expect.any(Date) });

    const confirming = await sentOrder(clinic);
    await pay(payments(gateway, { paymentTimeoutMs: 100 }), { token: confirming.token, payKey: randomUUID(), card: card("4000000000000101") });
    expect(await payPage(payments(gateway), confirming.token)).toMatchObject({ state: "confirming" });

    const cancelled = await sentOrder(clinic);
    await cancelOrder(orders(), clinic.provider, cancelled.ref);
    expect(await payPage(payments(gateway), cancelled.token)).toMatchObject({ state: "cancelled" });

    const expired = await sentOrder(clinic, new Date(Date.now() - 31 * 24 * 60 * MINUTE));
    expect(await payPage(payments(gateway), expired.token)).toMatchObject({ state: "expired" });

    expect(await payPage(payments(gateway), `${paid.ref}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });
});
