# Problem space

The problem space for the supplement-ordering slice, agreed with the user on 2026-10-05: what we're building, how money moves, and the quality bar. It doesn't choose a stack, data model, or seams; those are in [ARCHITECTURE.md](ARCHITECTURE.md).

Decisions and their trade-offs are in [DECISIONS.md](DECISIONS.md). Users and UX flows are in [USERS.md](USERS.md). How we used AI is in [AI_USAGE.md](AI_USAGE.md).

## Problem

Clinical providers recommend supplements as part of treatment plans. Today they buy them outside our EHR. The provider places the order for the patient, it ships to the patient, the provider pays at checkout, and the patient pays the provider back some other way. The provider fronts the money and chases reimbursement. Nothing reaches the clinical record or the practice's books.

We bring this in-house. A provider recommends supplements to a patient inside our product, the patient pays us directly, the provider's margin is routed to the provider, and we take a 75 bps platform fee. We hold the inventory. US only.

### Functional requirements (PRD)

1. A provider assembles an order for a patient: one or more supplements, with a patient-facing price (or margin) per item.
2. The patient pays. The payment step is stubbed.
3. The system computes and stores the split: item cost (COGS), provider margin, and the 75 bps fee.
4. The split is correct and auditable. A paid order shows where every cent went.
5. A provider dashboard shows what has been sold and lets the provider update which items they sell. There is no stock tracking. When an order is paid, we tell our inventory what sold, through a stub (D84): "update inventory" can also mean that, a reading we came to after the build.

### Out of scope (PRD)

Real payments, auth, and shipping. Patient-facing catalog browsing and search (a seeded list is fine). Regulatory, tax, and shipping cost. Multi-state and international. Stock levels.

### Impact metrics (PRD)

The headline metric is GMV processed in-house and the 75 bps we earn on it. The leading indicator is volume moved off third-party marketplaces. The data has to make both measurable cleanly.

## How this is judged

- **Technical judgment:** a sensible data model, clean seams, correct money handling, and pragmatic scoping under a time box.
- **AI leverage:** using AI to move fast and knowing when to override it.
- **Communication:** decisions and trade-offs explained crisply, and honesty about limitations.
- **Time box:** 1–2 days. Every feature has to earn its time.
- **Guidance from the technical contact:** "Make assumptions and document why you chose them."

## Product principle

The provider is the primary user. Providers bring the patients, so provider engagement drives growth and GMV. Remove provider friction wherever we can.

## Money model

Per item: **patient price = COGS + provider margin + platform fee.**

- **COGS:** what we paid the brand for the item. It is seeded data.
- **Platform fee:** 0.75% of the full item price, rounded up to the next whole cent, once per item (D17). Any fraction of a cent goes to the platform. It is built into the price and is never a separate line for the patient.
- **Provider margin:** what is left after COGS and the fee. It is computed by subtraction, so the three parts always add up exactly to the price.
- **Lowest price:** the smallest price where the margin is at least $0. With COGS of $20.00 that is $20.16 (fee $0.16, margin $0.00). At $20.15 the fee also rounds up to $0.16, which would leave a margin of −1¢. This is the no-profit option.
- **Highest price:** the MSRP (manufacturer's suggested retail price).
- **Price or margin entry:** the provider can type either. If they type a margin, we find the lowest price that earns exactly that margin. Each extra cent of price adds 0¢ or 1¢ of margin, so every margin can be hit exactly. With COGS of $20.00, both $36.00 and $36.01 earn $15.73, and we pick $36.00.
- **Payee:** the provider. Each provider belongs to a practice, so practice totals are possible later.

Worked example, COGS $20.00, price $36.00:

| Part | Amount |
|---|---|
| COGS | $20.00 |
| Platform fee (0.75% × $36.00) | $0.27 |
| Provider margin ($36.00 − $20.00 − $0.27) | $15.73 |
| **Patient pays** | **$36.00** |

## Store and screens

- There is one shared, seeded catalog. Each item shows our cost, its lowest price, and its highest price (MSRP).
- **My store:** the items a provider sells, each with a saved usual price.
- **New order:** the provider chooses a patient and picks items from My store. Prices start at the usual price and can be changed for this order. The provider gets or sends a link. The order locks once it is sent.
- **Patient checkout:** looks like the provider's store and is pre-filled with that patient's order. It shows the provider's name, the items, the prices, and the saving against retail. Pay leads to a confirmation page. Reopening a paid order shows "already paid". The patient cannot add items, because browsing is out of scope.
- **Sales:** the provider's orders with status, GMV, earnings, and fees.
- **Order details:** where every cent of a paid order went.

UX polish goes into New order and Checkout. Sales and My store stay plain.

## Demo data

- 6–10 supplements with real brand and product names and real retail prices (to be researched). COGS is about 50% of MSRP.
- Our own illustrated bottle images, labeled with the product name, each with alt text.
- A visible "Demo — not a real store" notice. The deployed site is hidden from search engines.
- Sample providers (one margin seller, one no-profit), patients, and a few months of past orders, so Sales and the metrics have something to show.

## Metrics

- **GMV** is the sum of patient prices on paid orders. **Platform revenue** is the sum of fees on paid orders.
- **Moved volume** is in-house GMV per provider per month, with each provider's first-order date and repeat orders.
- **Provider engagement** covers active providers per week, orders per provider, and time from creation to sending and to payment.
- Every order stores the provider who created it and its created, sent, and paid timestamps.

## Integrity rules

- All amounts are integer cents. The fee is rounded up once per item. The margin is computed by subtraction.
- A price below the lowest price or above MSRP is rejected.
- Paid orders and their split never change.
- Catalog or store changes after an order is sent do not change that order.
- An order cannot be paid twice.
- The fee rate is stored on each order, so a later rate change does not alter old orders.

## Quality areas

| Area | In the slice |
|---|---|
| Order states and failure handling: draft → sent → paid; declined payment; double click; payment succeeds but save fails; link reopened after payment; unclear result → needs review | Yes, core |
| Authorization behind a fake login: providers see only their own orders; the pay link uses an unguessable token and shows only that order | Yes |
| Privacy: minimal patient data; no product names in links or email subjects; no patient data in logs | Yes |
| Audit trail: who created and sent the order, price changes, paid time; paid records cannot change | Yes |
| Security: the server computes all money and never trusts amounts from the browser; no secrets in the repo | Yes |
| Fail-safes despite bugs: database constraints (whole non-negative cents, cost + fee + margin = price, one successful payment per order); check the split adds up before saving; idempotent payment; status changes in one place | Yes |
| Verification: a reconciliation check over paid orders; property-based tests on the money math | Yes |
| Testing focused on money math, one end-to-end flow, and negative cases | Yes |
| Accessibility to WCAG 2.2 AA, checked with axe and a keyboard pass | Yes |
| Mobile-first patient page | Yes |
| Observability: a log entry per status change with no patient data; a health check; totals from the database | Light |
| Performance: indexes for the Sales list; a light patient page; load tests at three scale levels on a laptop, with a report (D18) | Yes, stated and measured |
| One-command setup with seed data; deployed URL; CI on every push; README figures checked against a fresh test run | Yes |
| UTC timestamps; monthly totals in a stated time zone | Yes |
| Room for refunds, refills, and real payments later, through clean seams | Design only |

Unverified note: a 2024 HHS Section 504 rule requires healthcare organizations that receive federal funds to meet WCAG 2.1 AA.

## Known limitations

- **Card fees:** real card processing costs about 2.9% + 30¢, roughly four times the 75 bps fee. Every real order would lose money unless the business covers processing elsewhere. Payments are stubbed, so the slice is not affected.
- **Moved volume overcounts:** every in-house order counts as moved off a third-party site, including orders that only happen because ordering got easier. For example, 10 moved orders and 2 new ones would be reported as 12 moved. A later fix is to ask providers for their monthly third-party spend when they sign up.
