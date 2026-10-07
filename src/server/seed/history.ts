// About four months of order history for the demo (M6), made through the real
// Orders and Payments code with the clock set back (D57), so every order, line,
// payment and audit event is one the app itself could have written.
//
// It's the same every time: a fixed random seed picks patients, products and
// timings, counted back from the moment the seed runs. Each provider sends
// about five orders a month (§2). Older orders are mostly paid, with some
// cancelled and one left to expire; the last few weeks also hold open links
// and one draft. "Needs review" isn't seeded: the sweep settles it in seconds,
// and the 0101 test card shows it live.
import { randomUUID } from "node:crypto";
import { logLinkSender } from "../adapters/log-link-sender.ts";
import type { Db } from "../db/client.ts";
import { cancelOrder, type OrdersContext, saveDraft, sendOrder, startOrder } from "../orders/index.ts";
import { pay } from "../payments/index.ts";
import type { PaymentGateway } from "../ports/payment-gateway.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type HistoryProvider = {
  id: string;
  practiceId: string;
  patientIds: string[];
  /** The provider's store: product and usual price. */
  store: { catalogItemId: string; usualPriceCents: number }[];
};

type Settings = { feeRateBps: number; linkSigningKey: string; appUrl: string; linkTtlDays: number };

/** mulberry32: a small, fixed-seed generator, so the history is the same every time. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (low: number, high: number) => low + next() * (high - low),
    pick: <T>(items: T[]) => items[Math.floor(next() * items.length)],
  };
}

/** Seeded payments approve at once and are never looked up again; nothing touches the stub's file. */
const historyGateway: PaymentGateway = {
  async charge() {
    return { outcome: "approved", chargeRef: `ch_seed_${randomUUID().replace(/-/g, "").slice(0, 12)}` };
  },
  async lookup() {
    return { status: "not_charged" };
  },
};

type Plan = { createdAt: Date; outcome: "paid" | "cancelled" | "expired" | "sent" | "draft" };

/** About five orders a month for four months, at clinic hours, ending a day ago. */
function plan(random: ReturnType<typeof generator>, now: Date): Plan[] {
  const start = now.getTime() - 120 * DAY;
  const plans: Plan[] = [];
  for (let i = 0; i < 20; i++) {
    const day = Math.floor(random.between(0, 119));
    // 9am to 5pm Pacific is 16:00 to 24:00 UTC.
    const createdAt = new Date(start + day * DAY + random.between(16, 23.5) * HOUR);
    const age = now.getTime() - createdAt.getTime();
    const roll = random.next();
    const outcome: Plan["outcome"] =
      age < 25 * DAY ? (roll < 0.7 ? "paid" : roll < 0.9 ? "sent" : "cancelled") : roll < 0.88 ? "paid" : "cancelled";
    plans.push({ createdAt, outcome });
  }
  plans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // Every lasting status shows up: one link left to expire, one open link, one draft.
  plans[2].outcome = "expired";
  plans.push({ createdAt: new Date(now.getTime() - 4 * DAY - 3 * HOUR), outcome: "sent" });
  plans.push({ createdAt: new Date(now.getTime() - 1 * DAY - 2 * HOUR), outcome: "draft" });
  plans.push({ createdAt: new Date(now.getTime() - 40 * DAY), outcome: "cancelled" });
  return plans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function seedHistory(db: Db, providers: HistoryProvider[], settings: Settings, now: Date): Promise<number> {
  let made = 0;
  for (const [index, provider] of providers.entries()) {
    const random = generator(2026 + index);
    const paidBy = new Map<string, string>();
    const at = (time: Date): OrdersContext => ({ db, now: () => time, linkSender: logLinkSender, ...settings });
    const who = { id: provider.id, practiceId: provider.practiceId };

    for (const { createdAt, outcome } of plan(random, now)) {
      const patientId = random.pick(provider.patientIds);
      // About a quarter repeat the patient's last paid order (D31).
      const repeatOf = paidBy.get(patientId);
      const repeat = Boolean(repeatOf) && random.next() < 0.35;
      const started = await startOrder(at(createdAt), who, repeat ? { fromOrderRef: repeatOf! } : { patientId });
      if (!started.ok) throw new Error(`Seed couldn't start an order: ${started.error.message}`);
      made += 1;

      if (!repeat) {
        const count = 1 + Math.floor(random.next() * Math.min(3, provider.store.length));
        const items = [...provider.store].sort(() => random.next() - 0.5).slice(0, count);
        const saved = await saveDraft(at(new Date(createdAt.getTime() + 3 * MINUTE)), who, {
          ref: started.ref,
          lines: items.map((item) => ({
            catalogItemId: item.catalogItemId,
            quantity: random.next() < 0.2 ? 2 : 1,
            priceCents: item.usualPriceCents,
          })),
        });
        if (!saved.ok) throw new Error(`Seed couldn't save a draft: ${saved.error.message}`);
      }
      if (outcome === "draft") continue;

      const sentAt = new Date(createdAt.getTime() + random.between(5, 90) * MINUTE);
      const sent = await sendOrder(at(sentAt), who, started.ref);
      if (!sent.ok) throw new Error(`Seed couldn't send an order: ${sent.error.message}`);

      if (outcome === "paid") {
        const latest = Math.min(now.getTime() - HOUR, sentAt.getTime() + 3 * DAY);
        const paidAt = new Date(random.between(sentAt.getTime() + HOUR, Math.max(sentAt.getTime() + HOUR, latest)));
        const result = await pay(
          { db, now: () => paidAt, gateway: historyGateway, paymentTimeoutMs: 5_000, sweepAfterMs: 15_000, linkSigningKey: settings.linkSigningKey },
          {
            token: sent.link.split("/pay/")[1],
            payKey: randomUUID(),
            card: { number: "4242424242424242", expiry: "12/30", securityCode: "123", zip: "94110" },
          },
        );
        if (!(result.ok && result.outcome === "paid")) throw new Error(`Seed couldn't pay an order: ${JSON.stringify(result)}`);
        paidBy.set(patientId, started.ref);
      } else if (outcome === "cancelled") {
        const cancelAt = Math.min(now.getTime() - HOUR, sentAt.getTime() + random.between(1, 5) * DAY);
        const cancelled = await cancelOrder(at(new Date(Math.max(cancelAt, sentAt.getTime() + MINUTE))), who, started.ref);
        if (!cancelled.ok) throw new Error(`Seed couldn't cancel an order: ${cancelled.error.message}`);
      }
      // "sent" and "expired" stay as sent; an old enough link shows as Expired.
    }
  }
  return made;
}
