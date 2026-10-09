# Supplement store

A clinician builds a supplement order for a patient and sends a link; the patient pays us directly; the clinician's margin and our 0.75% fee are recorded on every item, to the cent. It's a take-home vertical slice, built and load-tested for the market leader's volume.

**Live demo: https://ecommerce-supplement-store-qywu.onrender.com** — a demo, not a real store, and hidden from search engines. It runs on free hosting that sleeps after 15 idle minutes, so **the first visit can take about a minute to wake up.**

[![CI](https://github.com/joshuatagoe/ecommerce-supplement-store/actions/workflows/ci.yml/badge.svg)](https://github.com/joshuatagoe/ecommerce-supplement-store/actions/workflows/ci.yml)
CI runs on GitHub only; the repo is mirrored to GitLab. [All CI runs](https://github.com/joshuatagoe/ecommerce-supplement-store/actions).

## Try it

1. **Sign in** by choosing a provider; there are no passwords. Dr. Rivera sells at a margin; Dr. Patel sells at cost. You land on **Sales**, with about four months of orders.
2. **New order** → search "Sam" → **Start order for Sam Okafor** → add items → **Send** → **Copy link**.
3. Open the link in a private window: that's the patient's page. Pay with a test card, listed under the form:

   | Card | What happens |
   |---|---|
   | 4242 4242 4242 4242 | Pays at once |
   | 4000 0000 0000 0002 | Declined; nothing charged |
   | 4000 0000 0000 0101 | Charged, but the payment company goes quiet: "We're confirming your payment", then the page shows Paid by itself |
   | 4000 0000 0000 0200 | Quiet and not charged: "confirming", then "Your payment didn't go through", and the patient can pay again |
   | 4000 0000 0000 0309 | Charged, then approved after a pause |

4. Back in the portal, open the order from **Sales**: **Where the money goes** shows each item's price, our cost, the fee and what the provider earns, with the audit trail below.

## The money, in one example

Dr. Rivera sends Sam one bottle of Magnesium Glycinate at **$36.00**. It costs us $20.00, and its retail price is $40.00.

| | |
|---|---|
| Our cost | $20.00 |
| Our fee: 0.75% of $36.00, rounded up to the next cent | $0.27 |
| Dr. Rivera earns | **$15.73** |
| Sam pays | **$36.00**, and saves $4.00 against retail |

- **Integer cents, everywhere.** The fee is rounded once per bottle, always up, and the margin is what's left, so the three parts always add up to the price (D17).
- **The split is frozen when the order is sent.** Later changes to cost, retail price or the fee rate never change a sent order (D27).
- **Prices stay between the lowest price** (the margin is $0.00: $20.16 for a $20.00 cost) **and retail** (D3, D14). A provider can type a price or the margin they want; typing a margin finds the lowest price that earns exactly it (D5).

## How it's built

One Next.js 16 server in TypeScript, and one PostgreSQL database. The business modules (Access, Store, Orders, Payments, Reporting, and a pure Pricing module shared with the browser) never import Next.js. The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

What keeps the money right:

- **The database refuses bad money even if the code has a bug.** Over 40 named rules (33 checks, 6 triggers, and unique indexes) include: frozen lines that add up, a fee that matches the formula, one live payment per order, a paid order whose payment succeeded, and an append-only audit trail. Each rule has a test that shows it refusing bad data.
- **Pay saves the attempt before it charges, and charges with the attempt's ID as the idempotency key.** A failure at any point leaves a record we can settle; nothing charges twice. A background sweep asks the payment company about anything left pending and settles it, and never charges again (§5).
- **An unexplained failure tells the patient "We're confirming your payment", never "declined"** (D23), and the page updates itself over server-sent events when the payment settles.
- **`npm run reconcile`** checks every paid order against its lines and its payment. It runs in the local checks, after every load test, and against the live data.

## Run it locally

You need **Node 24** and **Docker**.

```sh
npm run setup      # installs, starts Postgres in Docker, migrates, seeds the demo data, installs the test browser
npm run dev        # then open http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run verify` | Typecheck, lint, every unit, integration and property test, reconciliation on a fresh seed, and the check that this README's numbers are current |
| `npm run test:e2e` | The browser tests, with axe accessibility checks (rebuilds the local seed first) |
| `npm run seed -- --reset` | Rebuilds the demo data: two practices, eight products, about four months of orders |
| `npm run reconcile` | "Every paid order adds up", or the list of problems |
| `npm run metrics` | The PRD's numbers by month (below) |
| `npm run smoke` | Checks the live site: health for this commit, sign-in, and a pay link (read only) |
| `npm run load:l1` (also `load:race`, `load:l2`, `load:l3`, `drill:outage`) | The k6 load tests, after `npm run build` |

## Tests

- **363 unit, integration and property tests** (Vitest): golden money cases, property tests over thousands of random prices, every database rule against real Postgres, every row of the Pay flow's failure table, and races (twenty Sends at once give one link; fifty Pays at once give one charge).
- **62 browser tests** (Playwright): every user flow, axe on every page and pay-page state, keyboard-only runs, 320px-wide screens, and contrast themes.

These two counts are checked against a fresh run by `npm run verify`, so they can't go stale.

## Load tests

Run with k6 on a laptop ([docs/LOAD_TESTS.md](docs/LOAD_TESTS.md)):

- **The market leader's volume** (about 3 orders a second for 10 minutes): 1,800 orders, no errors, **95% of requests within 40 ms** against a 500 ms target.
- **Ten times that:** the single app server's CPU is the first limit, which more app copies fix (§2).
- **A database outage mid-run:** the server recovers on its own; no charge goes unrecorded and none happens twice.

Reconciliation is clean after every run.

## What's stubbed

| Stubbed | In the slice | The real version plugs in at |
|---|---|---|
| Payments | A stub payment company: test cards choose the outcome, and it keeps its own records | `PaymentGateway`: a Stripe Connect-style charge, then a transfer of the margin |
| Login | Pick a provider; the result is a real signed JWT in an HttpOnly cookie | The practice's identity provider, carried in the same cookie |
| Email | Sending is recorded; the provider copies the link | `LinkSender` |
| Inventory | A paid order records what sold on its audit trail; no stock is counted | `Inventory`: the warehouse system, through an outbox |
| The EHR's patient list | Seeded patients | `PatientDirectory` |
| Payouts | Earnings are recorded on each paid order | A payouts job |

## Platform numbers

`npm run metrics` prints the PRD's numbers by UTC month: GMV and the 75 bps we earn on it, active providers, repeat orders, how long orders take to send and to pay, and the volume each provider moved. From a fresh seed on 2026-10-07:

| Month | Paid orders | GMV | Fees | Active providers | Repeat orders | Median time to send | Median time to pay |
|---|---|---|---|---|---|---|---|
| 2026-06 | 3 | $160.05 | $1.22 | 2 | 0 | 23 min | 35.4 h |
| 2026-07 | 7 | $431.52 | $3.30 | 2 | 1 | 52 min | 29.8 h |
| 2026-08 | 13 | $823.42 | $6.29 | 2 | 5 | 42 min | 35.8 h |
| 2026-09 | 7 | $516.67 | $3.95 | 2 | 6 | 54 min | 34.4 h |
| 2026-10 | 3 | $122.52 | $0.94 | 2 | 1 | 24 min | 39.3 h |

## Decisions, cuts and AI use

- **[Decisions](docs/DECISIONS.md)**: 88 decisions, each with why and its trade-off, plus the assumptions. The biggest: integer cents with the fee rounded up per item (D17); save the payment attempt before charging (D21); one live payment per order, enforced by the database (D22); never tell a patient "declined" unless the payment company said so (D23); signed pay links instead of stored tokens (D25); one app server and one database (D20).
- **[Cut, and what's next](docs/DECISIONS.md#cut-and-whats-next)**: refunds, real payments and payouts, tax, shipping, stock, recurring orders (designed, not built), emailed receipts, patient verification, dark mode, and the scaling steps past Level 1, each with the next step.
- **[AI usage](docs/AI_USAGE.md)**: built with Claude Code, with the places the AI misled us and how each was caught. Among them: a money rule written into the plan without being checked; database rules that let NULLs through; a link-signing helper that would have been callable from the browser; and a page that only broke at phone width.

## Docs

| | |
|---|---|
| [docs/PROBLEM_SPACE.md](docs/PROBLEM_SPACE.md) | The problem, the money model, and what's in and out of scope |
| [docs/USERS.md](docs/USERS.md) | Who it's for and the five user flows, with what can go wrong in each |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Scale, the Pay flow, the data model and its rules, contracts, frontend, testing |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every decision and cut |
| [docs/LOAD_TESTS.md](docs/LOAD_TESTS.md) | Load test and outage drill results |
| [docs/AI_USAGE.md](docs/AI_USAGE.md) | How AI was used, and where it misled us |
