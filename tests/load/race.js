// The same-order race (ARCHITECTURE.md §2): 50 Pays at once on one order,
// mixing repeated and new Pay keys, and 20 Sends at once on one draft. Pass
// bar: exactly one charge reaches the payment company, and exactly one link
// is sent. scripts/load.ts checks the database and the stub afterwards.
import http from "k6/http";
import { check } from "k6";
import { action, ctx, formFields, payPath, postPay, redirectedRef } from "./lib.js";

export const options = {
  scenarios: {
    pays: { executor: "per-vu-iterations", vus: 50, iterations: 1, exec: "payRace" },
    sends: { executor: "per-vu-iterations", vus: 20, iterations: 1, exec: "sendRace" },
  },
  thresholds: { checks: ["rate==1"] },
};

function draft(provider) {
  const started = action("/orders/new", "startOrderAction", { patientId: provider.patientIds[0] }, provider.cookie, "start order");
  const ref = redirectedRef(started);
  const line = provider.lines[0];
  action(`/orders/${ref}`, "saveDraftAction", { ref, lines: [{ catalogItemId: line.catalogItemId, quantity: 1, priceCents: line.priceCents }] }, provider.cookie, "autosave");
  return ref;
}

export function setup() {
  const provider = ctx.providers[0];
  // The order everyone pays at once.
  const payRef = draft(provider);
  const sent = action(`/orders/${payRef}`, "sendOrderAction", { ref: payRef }, provider.cookie, "send");
  let path = payPath(sent.body);
  if (!path) path = payPath(http.get(`${ctx.base}/orders/${payRef}`, { headers: { Cookie: provider.cookie } }).body);
  // Ten page loads give ten Pay keys; 50 requests share them, five each.
  const forms = [];
  for (let i = 0; i < 10; i++) forms.push(formFields(http.get(`${ctx.base}${path}`).body));
  // The draft everyone sends at once.
  const sendRef = draft(provider);
  return { payRef, path, forms, sendRef, cookie: provider.cookie };
}

export function payRace(data) {
  const response = postPay(data.path, data.forms[(__VU - 1) % 10], "4242424242424242");
  // Every Pay gets an answer: paid, or confirming / payment in progress. None fails.
  check(response, { "pay answered": (r) => r.status === 303 });
}

export function sendRace(data) {
  const response = action(`/orders/${data.sendRef}`, "sendOrderAction", { ref: data.sendRef }, data.cookie, "send");
  check(response, { "send answered with the order": (r) => redirectedRef(r) === data.sendRef });
}

export function handleSummary(data) {
  return {
    "tests/load/.run/race-refs.json": JSON.stringify({ payRef: data.setup_data.payRef, sendRef: data.setup_data.sendRef }),
    stdout: `race: ${data.metrics.checks.values.passes} of ${data.metrics.checks.values.passes + data.metrics.checks.values.fails} requests answered as expected\n`,
  };
}
