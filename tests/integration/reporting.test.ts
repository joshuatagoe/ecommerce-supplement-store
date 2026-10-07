// Reporting against real Postgres (ARCHITECTURE.md §8 "Sales list", F4, F5,
// metrics): the Sales list with its search, filters, paging and totals; the
// audit trail; and the platform metrics. The dataset is built through the real
// Orders and Payments code with the clock set (D57).
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logLinkSender } from "@/server/adapters/log-link-sender";
import { stubPayments } from "@/server/adapters/stub-payments";
import { cancelOrder, type OrdersContext, saveDraft, sendOrder, startOrder } from "@/server/orders";
import { pay } from "@/server/payments";
import { monthTotals, orderAudit, platformMetrics, searchOrders } from "@/server/reporting";
import { makeClinic, type Scratch, scratchDatabase, type TestClinic } from "./scratch";

const KEY = "link-signing-key-that-is-at-least-32-chars";
const NOW = new Date("2026-11-15T12:00:00Z");
const LA = "America/Los_Angeles";
let scratch: Scratch;
let clinic: TestClinic;
let other: TestClinic;
const gateway = stubPayments({ path: join(mkdtempSync(join(tmpdir(), "stub-")), "stub.json"), slowApproveMs: 10, silenceMs: 100 });
const refs: Record<string, string> = {};

function orders(at: Date): OrdersContext {
  return { db: scratch.db, now: () => at, feeRateBps: 75, linkSigningKey: KEY, appUrl: "https://store.test", linkTtlDays: 30, linkSender: logLinkSender };
}

async function order(c: TestClinic, patientId: string, created: string, options: { sent?: string; paid?: string; from?: string } = {}) {
  const at = new Date(created);
  const started = options.from
    ? await startOrder(orders(at), c.provider, { fromOrderRef: options.from })
    : await startOrder(orders(at), c.provider, { patientId });
  if (!started.ok) throw new Error(started.error.message);
  if (!options.from) {
    await saveDraft(orders(at), c.provider, { ref: started.ref, lines: [{ catalogItemId: c.magnesiumId, quantity: 1, priceCents: 3600 }] });
  }
  if (options.sent) {
    const sent = await sendOrder(orders(new Date(options.sent)), c.provider, started.ref);
    if (!sent.ok) throw new Error(sent.error.message);
    if (options.paid) {
      const paidAt = new Date(options.paid);
      const result = await pay(
        { db: scratch.db, now: () => paidAt, gateway, paymentTimeoutMs: 2_000, sweepAfterMs: 15_000, linkSigningKey: KEY },
        { token: sent.link.split("/pay/")[1], payKey: randomUUID(), card: { number: "4242424242424242", expiry: "12/30", securityCode: "123", zip: "94110" } },
      );
      if (!(result.ok && result.outcome === "paid")) throw new Error(`not paid: ${JSON.stringify(result)}`);
    }
  }
  return started.ref;
}

const provider = (c: TestClinic) => ({ ...c.provider, timeZone: LA });
const ctx = () => ({ db: scratch.db, now: () => NOW });

beforeAll(async () => {
  scratch = await scratchDatabase("reporting");
  clinic = await makeClinic(scratch.pool);
  other = await makeClinic(scratch.pool);
  const maria = (
    await scratch.pool.query(
      "INSERT INTO patients (practice_id, first_name, last_name, email) VALUES ($1, 'Maria', 'Gonzalez', 'maria@example.com') RETURNING id",
      [clinic.practiceId],
    )
  ).rows[0].id as string;

  refs.september = await order(clinic, clinic.patientId, "2026-09-10T16:00:00Z", { sent: "2026-09-10T17:00:00Z", paid: "2026-09-10T18:00:00Z" });
  refs.october = await order(clinic, clinic.patientId, "2026-10-05T16:00:00Z", { sent: "2026-10-05T17:00:00Z", paid: "2026-10-05T18:00:00Z" });
  // Paid at 10pm Pacific on October 31: October in the practice's time zone, November in UTC (D29).
  refs.halloween = await order(clinic, maria, "2026-10-31T19:00:00Z", { sent: "2026-10-31T20:00:00Z", paid: "2026-11-01T05:00:00Z" });
  refs.sent = await order(clinic, clinic.patientId, "2026-10-20T16:00:00Z", { sent: "2026-10-20T17:00:00Z" });
  refs.expired = await order(clinic, clinic.patientId, "2026-08-01T16:00:00Z", { sent: "2026-08-01T17:00:00Z" });
  refs.draft = await order(clinic, clinic.patientId, "2026-11-02T16:00:00Z");
  refs.cancelled = await order(clinic, clinic.patientId, "2026-10-21T16:00:00Z", { sent: "2026-10-21T17:00:00Z" });
  await cancelOrder(orders(new Date("2026-10-22T16:00:00Z")), clinic.provider, refs.cancelled);
  refs.again = await order(clinic, clinic.patientId, "2026-11-03T16:00:00Z", { from: refs.october, sent: "2026-11-03T17:00:00Z", paid: "2026-11-04T17:00:00Z" });
  refs.otherProvider = await order(other, other.patientId, "2026-11-05T16:00:00Z", { sent: "2026-11-05T17:00:00Z", paid: "2026-11-05T18:00:00Z" });
}, 60_000);
afterAll(() => scratch?.drop());

const ONE_BOTTLE = { count: 1, totalCents: 3600, marginCents: 1573, feeCents: 27 };

describe("searchOrders: the Sales list (F4, D31)", () => {
  it("lists every order the provider created, newest first, with its status word and action", async () => {
    const result = await searchOrders(ctx(), provider(clinic), { dateField: "created" });
    expect(result.count).toBe(8);
    expect(result.rows.map((row) => row.ref)).toEqual([
      refs.again,
      refs.draft,
      refs.halloween,
      refs.cancelled,
      refs.sent,
      refs.october,
      refs.september,
      refs.expired,
    ]);
    expect(result.rows.find((row) => row.ref === refs.halloween)).toMatchObject({
      patientName: "Maria Gonzalez",
      display: "paid",
      actions: ["order_again"],
      totalCents: 3600,
      marginCents: 1573,
    });
    expect(result.rows.find((row) => row.ref === refs.draft)).toMatchObject({ display: "draft", actions: ["continue", "discard_draft"], totalCents: 3600, marginCents: null });
    expect(result.rows.find((row) => row.ref === refs.expired)).toMatchObject({ display: "expired", actions: ["new_link", "cancel_order"] });
  });

  it("never shows another provider's orders", async () => {
    const mine = await searchOrders(ctx(), provider(clinic), { dateField: "created" });
    expect(mine.rows.map((row) => row.ref)).not.toContain(refs.otherProvider);
    const theirs = await searchOrders(ctx(), provider(other), { dateField: "created" });
    expect(theirs.rows.map((row) => row.ref)).toEqual([refs.otherProvider]);
  });

  it("filters by status, with Expired and Sent worked out from the link's expiry", async () => {
    const by = async (status: string) =>
      (await searchOrders(ctx(), provider(clinic), { dateField: "created", status: status as never })).rows.map((row) => row.ref);
    expect(await by("expired")).toEqual([refs.expired]);
    expect(await by("sent")).toEqual([refs.sent]);
    expect(await by("draft")).toEqual([refs.draft]);
    expect(await by("cancelled")).toEqual([refs.cancelled]);
    expect(await by("paid")).toEqual([refs.again, refs.halloween, refs.october, refs.september]);
    expect(await by("needs_review")).toEqual([]);
  });

  it("searches by patient name or order ref, matching the text literally", async () => {
    const search = async (text: string) =>
      (await searchOrders(ctx(), provider(clinic), { dateField: "created", text })).rows.map((row) => row.ref);
    expect(await search("maria")).toEqual([refs.halloween]);
    expect(await search("GONZ")).toEqual([refs.halloween]);
    expect(await search(refs.october)).toEqual([refs.october]);
    expect(await search(refs.october.slice(0, 4).toLowerCase())).toContain(refs.october);
    expect(await search("%")).toEqual([]);
  });

  it("filters on paid date in the practice's time zone: a payment at 10pm Pacific on October 31 is October", async () => {
    const october = await searchOrders(ctx(), provider(clinic), { dateField: "paid", from: "2026-10-01", to: "2026-10-31" });
    expect(october.rows.map((row) => row.ref)).toEqual([refs.halloween, refs.october]);
    const november = await searchOrders(ctx(), provider(clinic), { dateField: "paid", from: "2026-11-01", to: "2026-11-30" });
    expect(november.rows.map((row) => row.ref)).toEqual([refs.again]);
  });

  it("sorts by the chosen date, newest first, with orders that lack it last", async () => {
    const bySent = await searchOrders(ctx(), provider(clinic), { dateField: "sent" });
    expect(bySent.rows.at(-1)?.ref).toBe(refs.draft);
    expect(bySent.rows[0].ref).toBe(refs.again);
  });

  it("adds up the paid orders in the view for the footer", async () => {
    const paid = await searchOrders(ctx(), provider(clinic), { dateField: "created", status: "paid" });
    expect(paid.footerTotals).toEqual({ count: 4, totalCents: 14400, marginCents: 6292, feeCents: 108 });
    const none = await searchOrders(ctx(), provider(clinic), { dateField: "created", status: "sent" });
    expect(none.footerTotals).toEqual({ count: 0, totalCents: 0, marginCents: 0, feeCents: 0 });
  });

  it("pages 25 at a time with a cursor, and counts every match", async () => {
    const first = await searchOrders(ctx(), provider(clinic), { dateField: "created" }, 3);
    expect(first.rows).toHaveLength(3);
    expect(first.count).toBe(8);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await searchOrders(ctx(), provider(clinic), { dateField: "created", cursor: first.nextCursor! }, 3);
    expect(second.rows.map((row) => row.ref)).toEqual([refs.cancelled, refs.sent, refs.october]);
    const last = await searchOrders(ctx(), provider(clinic), { dateField: "created", cursor: second.nextCursor! }, 3);
    expect(last.rows).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });
});

describe("monthTotals: the headline (D31)", () => {
  it("covers this month so far by paid date in the practice's time zone, ignoring filters", async () => {
    expect(await monthTotals(ctx(), provider(clinic))).toEqual({ month: "November 2026", ...ONE_BOTTLE });
    const endOfOctober = { db: scratch.db, now: () => new Date("2026-11-01T06:00:00Z") };
    // 11pm Pacific on October 31: both October payments count.
    expect(await monthTotals(endOfOctober, provider(clinic))).toEqual({
      month: "October 2026",
      count: 2,
      totalCents: 7200,
      marginCents: 3146,
      feeCents: 54,
    });
  });
});

describe("orderAudit: Order details (F5)", () => {
  it("lists the audit trail in time order, with the payment reference", async () => {
    const audit = await orderAudit(ctx(), provider(clinic), refs.october);
    expect(audit?.chargeRef).toMatch(/^ch_/);
    expect(audit?.events.map((event) => [event.kind, event.actorType])).toEqual([
      ["created", "provider"],
      ["sent", "provider"],
      ["link_sent", "system"],
      ["paid", "patient"],
    ]);
  });

  it("hides another provider's order", async () => {
    expect(await orderAudit(ctx(), provider(other), refs.october)).toBeNull();
  });
});

describe("platformMetrics: the PRD's numbers by UTC month", () => {
  it("counts GMV, fees and paid orders by UTC month, so 10pm Pacific on October 31 is November", async () => {
    const months = await platformMetrics(scratch.db);
    const byMonth = Object.fromEntries(months.map((month) => [month.month, month]));
    expect(byMonth["2026-09"]).toMatchObject({ paidOrders: 1, gmvCents: 3600, feeCents: 27 });
    expect(byMonth["2026-10"]).toMatchObject({ paidOrders: 1, gmvCents: 3600, feeCents: 27 });
    expect(byMonth["2026-11"]).toMatchObject({ paidOrders: 3, gmvCents: 10800, feeCents: 81, activeProviders: 2, repeatOrders: 1 });
  });

  it("measures time from start to send and from send to payment", async () => {
    const months = await platformMetrics(scratch.db);
    const september = months.find((month) => month.month === "2026-09");
    expect(september).toMatchObject({ medianMinutesToSend: 60, medianMinutesToPay: 60 });
  });

  it("shows moved volume per provider, with the date each provider first sent an order", async () => {
    const months = await platformMetrics(scratch.db);
    const november = months.find((month) => month.month === "2026-11")!;
    expect(november.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ gmvCents: 7200, firstOrderAt: new Date("2026-08-01T17:00:00Z") })]),
    );
  });
});
