// Orders against real Postgres with real transactions (ARCHITECTURE.md §4, §8,
// F2): drafts, Send, signed links, New link, Cancel order, Order again.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logLinkSender } from "@/server/adapters/log-link-sender";
import { seededPatients } from "@/server/adapters/seeded-patients";
import { linkToken, orderForToken } from "@/server/links";
import {
  cancelOrder,
  getOrder,
  newLink,
  type OrdersContext,
  recentOrders,
  saveDraft,
  sendOrder,
  startOrder,
} from "@/server/orders";
import { makeClinic, type Scratch, scratchDatabase, type TestClinic } from "./scratch";

const KEY = "link-signing-key-that-is-at-least-32-chars";
const DAY = 24 * 60 * 60 * 1000;
let scratch: Scratch;

beforeAll(async () => {
  scratch = await scratchDatabase("orders");
}, 30_000);
afterAll(() => scratch?.drop());

function ctx(now = new Date("2026-10-07T17:00:00Z")): OrdersContext {
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

async function draftFor(clinic: TestClinic, at?: Date): Promise<string> {
  const started = await startOrder(ctx(at), clinic.provider, { patientId: clinic.patientId });
  if (!started.ok) throw new Error(started.error.message);
  return started.ref;
}

async function sentOrder(clinic: TestClinic, at?: Date): Promise<{ ref: string; link: string }> {
  const ref = await draftFor(clinic, at);
  await saveDraft(ctx(at), clinic.provider, { ref, lines: [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 }] });
  const sent = await sendOrder(ctx(at), clinic.provider, ref);
  if (!sent.ok) throw new Error(sent.error.message);
  return { ref, link: sent.link };
}

async function row(text: string, values: unknown[]): Promise<Record<string, unknown>> {
  return (await scratch.pool.query(text, values)).rows[0];
}

async function events(ref: string): Promise<string[]> {
  const { rows } = await scratch.pool.query(
    "SELECT e.kind FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.ref = $1 ORDER BY e.at, e.id",
    [ref],
  );
  return rows.map((r) => r.kind);
}

async function pendingAttempt(ref: string): Promise<void> {
  await scratch.pool.query(
    "INSERT INTO payment_attempts (order_id, idempotency_key, amount_cents, status) SELECT id, $2, total_cents, 'pending' FROM orders WHERE ref = $1",
    [ref, randomUUID()],
  );
}

describe("startOrder", () => {
  it("starts a draft for a patient in the provider's practice", async () => {
    const clinic = await makeClinic(scratch.pool);
    const result = await startOrder(ctx(), clinic.provider, { patientId: clinic.patientId });
    expect(result).toMatchObject({ ok: true, ref: expect.stringMatching(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/), leftOut: [] });
    const ref = (result as { ref: string }).ref;
    expect(await row("SELECT status, provider_id, practice_id, patient_id FROM orders WHERE ref = $1", [ref])).toEqual({
      status: "draft",
      provider_id: clinic.provider.id,
      practice_id: clinic.practiceId,
      patient_id: clinic.patientId,
    });
    expect(await events(ref)).toEqual(["created"]);
  });

  it("refuses a patient from another practice", async () => {
    const clinic = await makeClinic(scratch.pool);
    expect(await startOrder(ctx(), clinic.provider, { patientId: clinic.otherPatientId })).toMatchObject({
      ok: false,
      error: { code: "PATIENT_NOT_IN_PRACTICE" },
    });
  });

  it("refuses when My store is empty, so New order can send the provider there (F1)", async () => {
    const clinic = await makeClinic(scratch.pool);
    await scratch.pool.query("DELETE FROM store_items WHERE provider_id = $1", [clinic.provider.id]);
    expect(await startOrder(ctx(), clinic.provider, { patientId: clinic.patientId })).toMatchObject({
      ok: false,
      error: { code: "STORE_EMPTY" },
    });
  });
});

describe("saveDraft (autosave)", () => {
  it("saves price and margin lines and returns each line's split and the totals", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    const result = await saveDraft(ctx(), clinic.provider, {
      ref,
      lines: [
        { catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 },
        // A $10.00 margin on a $14.98 cost: the lowest price that earns exactly it is $25.17 (D5).
        { catalogItemId: clinic.omegaId, quantity: 2, marginCents: 1000 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      lines: [
        { catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600, split: { priceCents: 3600, costCents: 2000, feeCents: 27, marginCents: 1573 } },
        { catalogItemId: clinic.omegaId, quantity: 2, priceCents: 2517, split: { priceCents: 5034, costCents: 2996, feeCents: 38, marginCents: 2000 } },
      ],
      totals: { priceCents: 8634, costCents: 4996, feeCents: 65, marginCents: 3573 },
    });
  });

  it("works the split per bottle, then multiplies (D28): 2 × $36.10 pays 56¢ in fees and earns $31.64", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    const result = await saveDraft(ctx(), clinic.provider, {
      ref,
      lines: [{ catalogItemId: clinic.magnesiumId, quantity: 2, priceCents: 3610 }],
    });
    expect(result).toMatchObject({ ok: true, totals: { priceCents: 7220, feeCents: 56, marginCents: 3164 } });
  });

  it("saves an out-of-range price so no work is lost, and flags it with its allowed range (§4)", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    const result = await saveDraft(ctx(), clinic.provider, {
      ref,
      lines: [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 2015 }],
    });
    expect(result).toMatchObject({
      ok: true,
      lines: [
        {
          priceCents: 2015,
          rangeError: {
            code: "PRICE_BELOW_LOWEST",
            message: "The lowest price for this item is $20.16. Below that you would lose money.",
            lowestPriceCents: 2016,
            msrpCents: 4000,
          },
        },
      ],
    });
    expect(await row("SELECT unit_price_cents FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.ref = $1", [ref])).toEqual({
      unit_price_cents: 2015,
    });
  });

  it("replaces the lines, so a line left out is removed", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    await saveDraft(ctx(), clinic.provider, {
      ref,
      lines: [
        { catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 },
        { catalogItemId: clinic.omegaId, quantity: 1, priceCents: 2700 },
      ],
    });
    await saveDraft(ctx(), clinic.provider, { ref, lines: [{ catalogItemId: clinic.omegaId, quantity: 3, priceCents: 2700 }] });
    const { rows } = await scratch.pool.query(
      "SELECT catalog_item_id, quantity FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.ref = $1",
      [ref],
    );
    expect(rows).toEqual([{ catalog_item_id: clinic.omegaId, quantity: 3 }]);
  });

  it("records a price change in the audit trail, and nothing when the price didn't change", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    const line = { catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 };
    await saveDraft(ctx(), clinic.provider, { ref, lines: [line] });
    await saveDraft(ctx(), clinic.provider, { ref, lines: [line] });
    await saveDraft(ctx(), clinic.provider, { ref, lines: [{ ...line, priceCents: 3700 }] });
    expect(await events(ref)).toEqual(["created", "price_changed"]);
    expect(
      await row(
        "SELECT e.details FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.ref = $1 AND e.kind = 'price_changed'",
        [ref],
      ),
    ).toEqual({ details: { catalogItemId: clinic.magnesiumId, fromCents: 3600, toCents: 3700 } });
  });

  it("refuses an item that isn't in My store", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    expect(
      await saveDraft(ctx(), clinic.provider, { ref, lines: [{ catalogItemId: clinic.zincId, quantity: 1, priceCents: 1500 }] }),
    ).toMatchObject({ ok: false, error: { code: "ITEM_NOT_IN_STORE", field: "lines.0.catalogItemId" } });
  });

  it("refuses to edit a sent order, and hides another provider's order", async () => {
    const clinic = await makeClinic(scratch.pool);
    const other = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    const lines = [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3700 }];
    expect(await saveDraft(ctx(), clinic.provider, { ref, lines })).toMatchObject({ ok: false, error: { code: "ORDER_NOT_DRAFT" } });
    expect(await saveDraft(ctx(), other.provider, { ref, lines })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("sendOrder (§8)", () => {
  it("freezes each line with today's cost, sets the totals and the link, and records it", async () => {
    const clinic = await makeClinic(scratch.pool);
    const now = new Date("2026-10-07T17:00:00Z");
    const ref = await draftFor(clinic, now);
    await saveDraft(ctx(now), clinic.provider, {
      ref,
      lines: [{ catalogItemId: clinic.magnesiumId, quantity: 2, priceCents: 3600 }],
    });
    const sent = await sendOrder(ctx(now), clinic.provider, ref);
    expect(sent).toEqual({
      ok: true,
      link: `https://store.test/pay/${linkToken(KEY, ref, 1)}`,
      expiresAt: new Date(now.getTime() + 30 * DAY).toISOString(),
    });

    const line = await row(
      `SELECT l.frozen_at, l.unit_cost_cents, l.fee_rate_bps, l.unit_fee_cents, l.unit_margin_cents, l.unit_msrp_cents, l.product_name
         FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.ref = $1`,
      [ref],
    );
    expect(line).toMatchObject({
      frozen_at: now,
      unit_cost_cents: 2000,
      fee_rate_bps: 75,
      unit_fee_cents: 27,
      unit_margin_cents: 1573,
      unit_msrp_cents: 4000,
      product_name: expect.stringMatching(/^Magnesium Glycinate .+, 120 capsules$/),
    });
    expect(
      await row(
        "SELECT status, sent_at, link_version, link_expires_at, fee_rate_bps, total_cents, cost_cents, fee_cents, margin_cents FROM orders WHERE ref = $1",
        [ref],
      ),
    ).toEqual({
      status: "sent",
      sent_at: now,
      link_version: 1,
      link_expires_at: new Date(now.getTime() + 30 * DAY),
      fee_rate_bps: 75,
      total_cents: 7200,
      cost_cents: 4000,
      fee_cents: 54,
      margin_cents: 3146,
    });
    expect(await events(ref)).toEqual(["created", "sent", "link_sent"]);
  });

  it("refuses an empty order", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    expect(await sendOrder(ctx(), clinic.provider, ref)).toMatchObject({ ok: false, error: { code: "ORDER_EMPTY" } });
  });

  it("refuses a line that is out of range against today's cost, naming the line", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    await saveDraft(ctx(), clinic.provider, { ref, lines: [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 }] });
    // Our cost rises after the draft was saved (D27): $36.00 no longer covers it.
    await scratch.pool.query("UPDATE catalog_items SET cost_cents = 3590 WHERE id = $1", [clinic.magnesiumId]);
    expect(await sendOrder(ctx(), clinic.provider, ref)).toMatchObject({
      ok: false,
      error: {
        code: "LINES_OUT_OF_RANGE",
        lines: [{ catalogItemId: clinic.magnesiumId, code: "PRICE_BELOW_LOWEST", message: expect.stringContaining("$36.18") }],
      },
    });
    expect(await row("SELECT status FROM orders WHERE ref = $1", [ref])).toEqual({ status: "draft" });
  });

  it("gives a double-clicked Send one link: twenty Sends at once, one send", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    await saveDraft(ctx(), clinic.provider, { ref, lines: [{ catalogItemId: clinic.magnesiumId, quantity: 1, priceCents: 3600 }] });
    const results = await Promise.all(Array.from({ length: 20 }, () => sendOrder(ctx(), clinic.provider, ref)));
    const links = new Set(results.map((result) => (result.ok ? result.link : result.error.code)));
    expect([...links]).toEqual([`https://store.test/pay/${linkToken(KEY, ref, 1)}`]);
    expect(await events(ref)).toEqual(["created", "sent", "link_sent"]);
  });
});

describe("pay links (§6)", () => {
  it("opens exactly its order, and nothing for a made-up or broken token", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, link } = await sentOrder(clinic);
    const token = link.split("/pay/")[1];
    expect(await orderForToken(scratch.db, KEY, token)).toMatchObject({ ref, status: "sent" });
    expect(await orderForToken(scratch.db, KEY, `${ref}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(await orderForToken(scratch.db, KEY, linkToken(KEY, "ZZZZ-ZZZZ", 1))).toBeNull();
    expect(await orderForToken(scratch.db, `${KEY}-rotated`, token)).toBeNull();
    expect(await orderForToken(scratch.db, KEY, "nonsense")).toBeNull();
  });

  it("has no link for a draft", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    expect(await orderForToken(scratch.db, KEY, linkToken(KEY, ref, 1))).toBeNull();
  });
});

describe("newLink", () => {
  it("turns the old link off and restarts the 30 days", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, link } = await sentOrder(clinic, new Date("2026-10-01T12:00:00Z"));
    const later = new Date("2026-10-20T12:00:00Z");
    const fresh = await newLink(ctx(later), clinic.provider, ref);
    expect(fresh).toEqual({
      ok: true,
      link: `https://store.test/pay/${linkToken(KEY, ref, 2)}`,
      expiresAt: new Date(later.getTime() + 30 * DAY).toISOString(),
    });
    expect(await orderForToken(scratch.db, KEY, link.split("/pay/")[1])).toBeNull();
    expect(await orderForToken(scratch.db, KEY, linkToken(KEY, ref, 2))).toMatchObject({ ref });
    expect(await events(ref)).toEqual(["created", "sent", "link_sent", "new_link", "link_sent"]);
  });

  it("works on an expired link", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic, new Date("2026-08-01T12:00:00Z"));
    expect(await newLink(ctx(new Date("2026-10-07T12:00:00Z")), clinic.provider, ref)).toMatchObject({ ok: true });
  });

  it("waits while a payment is in progress, and needs a sent order", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    await pendingAttempt(ref);
    expect(await newLink(ctx(), clinic.provider, ref)).toMatchObject({ ok: false, error: { code: "PAYMENT_IN_PROGRESS" } });
    const draft = await draftFor(clinic);
    expect(await newLink(ctx(), clinic.provider, draft)).toMatchObject({ ok: false, error: { code: "ORDER_NOT_SENT" } });
  });
});

describe("cancelOrder", () => {
  it("discards a draft", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    expect(await cancelOrder(ctx(), clinic.provider, ref)).toEqual({ ok: true, status: "cancelled" });
    expect(await events(ref)).toEqual(["created", "draft_discarded"]);
  });

  it("cancels a sent order, and its link then shows the order as cancelled", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref, link } = await sentOrder(clinic);
    expect(await cancelOrder(ctx(), clinic.provider, ref)).toEqual({ ok: true, status: "cancelled" });
    expect(await orderForToken(scratch.db, KEY, link.split("/pay/")[1])).toMatchObject({ status: "cancelled" });
    expect(await cancelOrder(ctx(), clinic.provider, ref)).toMatchObject({ ok: false, error: { code: "ORDER_FINAL" } });
  });

  it("waits while a payment is in progress (§5: a cancel can't race a payment)", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    await pendingAttempt(ref);
    expect(await cancelOrder(ctx(), clinic.provider, ref)).toMatchObject({ ok: false, error: { code: "PAYMENT_IN_PROGRESS" } });
    expect(await row("SELECT status FROM orders WHERE ref = $1", [ref])).toEqual({ status: "sent" });
  });

  it("never cancels another provider's order", async () => {
    const clinic = await makeClinic(scratch.pool);
    const other = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    expect(await cancelOrder(ctx(), other.provider, ref)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("Order again (D31)", () => {
  it("copies the items still in My store, with their quantities and prices, and names the ones left out", async () => {
    const clinic = await makeClinic(scratch.pool);
    const ref = await draftFor(clinic);
    await saveDraft(ctx(), clinic.provider, {
      ref,
      lines: [
        { catalogItemId: clinic.magnesiumId, quantity: 2, priceCents: 3500 },
        { catalogItemId: clinic.omegaId, quantity: 1, priceCents: 2700 },
      ],
    });
    await sendOrder(ctx(), clinic.provider, ref);
    await scratch.pool.query("DELETE FROM store_items WHERE provider_id = $1 AND catalog_item_id = $2", [clinic.provider.id, clinic.omegaId]);

    const again = await startOrder(ctx(), clinic.provider, { fromOrderRef: ref });
    expect(again).toMatchObject({ ok: true, leftOut: [expect.stringMatching(/^Ultimate Omega /)] });
    const copy = (again as { ref: string }).ref;
    expect(copy).not.toBe(ref);
    const { rows } = await scratch.pool.query(
      "SELECT l.catalog_item_id, l.quantity, l.unit_price_cents, l.frozen_at FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.ref = $1",
      [copy],
    );
    expect(rows).toEqual([{ catalog_item_id: clinic.magnesiumId, quantity: 2, unit_price_cents: 3500, frozen_at: null }]);
    expect(await row("SELECT s.ref FROM orders o JOIN orders s ON s.id = o.source_order_id WHERE o.ref = $1", [copy])).toEqual({ ref });
  });

  it("never repeats another provider's order", async () => {
    const clinic = await makeClinic(scratch.pool);
    const other = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    expect(await startOrder(ctx(), other.provider, { fromOrderRef: ref })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("reading orders", () => {
  it("shows a draft with live splits, and a sent order as it was frozen", async () => {
    const clinic = await makeClinic(scratch.pool);
    const { ref } = await sentOrder(clinic);
    await scratch.pool.query("UPDATE catalog_items SET cost_cents = 2500 WHERE id = $1", [clinic.magnesiumId]);
    const view = await getOrder(ctx(), clinic.provider, ref);
    expect(view).toMatchObject({
      ref,
      status: "sent",
      display: "sent",
      actions: ["copy_link", "new_link", "cancel_order"],
      patient: { id: clinic.patientId, name: expect.stringMatching(/^Sam Okafor/) },
      link: `https://store.test/pay/${linkToken(KEY, ref, 1)}`,
      lines: [{ quantity: 1, priceCents: 3600, split: { costCents: 2000, feeCents: 27, marginCents: 1573 } }],
      totals: { priceCents: 3600, marginCents: 1573 },
    });
    expect(await getOrder(ctx(), (await makeClinic(scratch.pool)).provider, ref)).toBeNull();
  });

  it("lists a patient's recent orders for Order again, newest first, without drafts", async () => {
    const clinic = await makeClinic(scratch.pool);
    const first = await sentOrder(clinic, new Date("2026-09-01T12:00:00Z"));
    const second = await sentOrder(clinic, new Date("2026-09-15T12:00:00Z"));
    await draftFor(clinic);
    const recent = await recentOrders(ctx(new Date("2026-10-07T12:00:00Z")), clinic.provider, clinic.patientId);
    expect(recent.map((order) => order.ref)).toEqual([second.ref, first.ref]);
    expect(recent[0]).toMatchObject({ display: "sent", totalCents: 3600, itemCount: 1 });
  });
});

describe("patient search (§3 PatientDirectory)", () => {
  it("finds patients by the start of their first or last name, in the provider's practice only", async () => {
    const clinic = await makeClinic(scratch.pool);
    const patients = seededPatients(scratch.db);
    expect((await patients.search(clinic.practiceId, "sa")).map((p) => p.id)).toContain(clinic.patientId);
    expect((await patients.search(clinic.practiceId, "OKAFOR")).map((p) => p.id)).toContain(clinic.patientId);
    expect(await patients.search(clinic.practiceId, "olivia")).toEqual([]);
    expect(await patients.search(clinic.practiceId, "")).toEqual([]);
    expect(await patients.search(clinic.practiceId, "%")).toEqual([]);
  });
});
