// One simulated order per iteration, at a fixed rate (ARCHITECTURE.md §2):
// the provider starts an order, autosaves twice and sends it; the patient
// opens the pay page and pays; every fifth order, the provider loads Sales.
// Run through scripts/load.ts, which sets RATE, DURATION, VUS and MODE.
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";
import { action, ctx, formFields, payPath, pick, postPay, redirectedRef } from "./lib.js";

const paid = new Rate("orders_paid");
const completed = new Counter("orders_completed");

const MODE = __ENV.MODE;
const levelOne = MODE === "l1";

export const options = {
  scenarios: {
    orders: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE),
      timeUnit: "1s",
      duration: __ENV.DURATION,
      preAllocatedVUs: Number(__ENV.VUS),
      maxVUs: Number(__ENV.VUS) * 2,
    },
  },
  // Level 1 must pass (§2): no errors, and 95% of requests within 500 ms.
  thresholds: Object.assign(
    levelOne ? { http_req_failed: ["rate==0"], http_req_duration: ["p(95)<500"], orders_paid: ["rate==1"] } : {},
    // Always true: these only make k6 report each step's timing, to show which step slows first.
    Object.fromEntries(
      ["start order", "autosave", "send", "sent order", "pay page", "pay", "receipt", "sales"].map((step) => [
        `http_req_duration{name:${step}}`,
        ["p(95)>=0"],
      ]),
    ),
  ),
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function oneOrder() {
  const provider = pick(ctx.providers);
  const cookie = provider.cookie;
  const items = [...provider.lines].sort(() => Math.random() - 0.5).slice(0, 2);

  const started = action("/orders/new", "startOrderAction", { patientId: pick(provider.patientIds) }, cookie, "start order");
  const ref = redirectedRef(started);
  if (!check(started, { "order started": () => ref !== null })) return paid.add(false);

  const lines = items.map((line) => ({ catalogItemId: line.catalogItemId, quantity: 1, priceCents: line.priceCents }));
  const firstSave = action(`/orders/${ref}`, "saveDraftAction", { ref, lines: lines.slice(0, 1) }, cookie, "autosave");
  const secondSave = action(`/orders/${ref}`, "saveDraftAction", { ref, lines }, cookie, "autosave");
  check(firstSave, { "autosaved": (r) => r.body.includes('"ok":true') });
  check(secondSave, { "autosaved": (r) => r.body.includes('"ok":true') });

  const sent = action(`/orders/${ref}`, "sendOrderAction", { ref }, cookie, "send");
  if (!check(sent, { "sent": (r) => (r.headers["X-Action-Redirect"] || "").includes("notice=sent") })) return paid.add(false);
  // The provider lands on the sent order and copies its link.
  let path = payPath(sent.body);
  if (!path) path = payPath(http.get(`${ctx.base}/orders/${ref}`, { headers: { Cookie: cookie }, tags: { name: "sent order" } }).body);
  if (!check(path, { "link shown": (p) => p !== null })) return paid.add(false);

  // Sam opens the link and pays with 4242, which approves at once.
  const page = http.get(`${ctx.base}${path}`, { tags: { name: "pay page" } });
  const fields = formFields(page.body);
  const payment = postPay(path, fields, "4242424242424242");
  const location = payment.headers["Location"] || "";
  const ok = check(payment, { "paid": (r) => r.status === 303 && location.includes("notice=paid") });
  paid.add(ok);
  if (ok) {
    http.get(`${ctx.base}${location}`, { tags: { name: "receipt" } });
    completed.add(1);
  }

  // Sales: one page load for every five orders.
  if (Math.random() < 0.2) http.get(`${ctx.base}/sales`, { headers: { Cookie: cookie }, tags: { name: "sales" } });
}
