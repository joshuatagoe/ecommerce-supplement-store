# Load tests

The load tests planned in [ARCHITECTURE.md §2](ARCHITECTURE.md#load-tests), run with k6 on the user's laptop on 2026-10-07 (D18). The result is that the slice holds the market leader's volume with a wide margin, and the money stays right at every level, including past the point where the server gives up.

| Test | Pass bar (§2) | Result | |
|---|---|---|---|
| **Same-order race** | Exactly one charge reaches the payment company, and exactly one link is sent | 50 Pays at once saved 1 attempt and made 1 charge; 20 Sends at once recorded 1 send and 1 link | Pass |
| **Level 1:** about 3 orders a second for 10 minutes | No errors; 95% of requests within 500 ms; reconciliation clean | 1,800 orders, 12,948 requests, 0 errors; 95% within **40 ms**; reconciliation clean | Pass |
| **Level 2:** about 30 orders a second | Record the result and the first thing that slows down | About 12 orders a second completed; 0 errors; 95% within 22.5 s. The app server's CPU runs out first. | Recorded |
| **Level 3:** about 800 orders a second | Expected to fail; record where | 31 orders a second started; 26% of requests failed, waiting for a database connection or refused by the laptop | Failed, as expected |
| **Database outage drill** | No double charges, no paid order lost, reconciliation clean | 30 s outage: 2.1% of requests failed; 624 charges, 624 recorded payments, 0 double charges, reconciliation clean | Pass |

In every test, including Level 3, reconciliation came back clean, no order was charged twice, and every charge the payment company took was recorded as a payment.

## How the tests run

- **One command per test:** `npm run load:race`, `load:l1`, `load:l2`, `load:l3` and `drill:outage`, after `npm run build`. `scripts/load.ts` runs each one.
- **A database of its own.** Each run drops and rebuilds `store_load` on the local Postgres, runs the migrations, and seeds the demo data with its four months of history. The shared dev server and its sweep never touch it.
- **The production build.** The app runs as `next start` on port 3100, one Node process, with the stub payment company keeping its records in `.data/load-stub.json`.
- **The real request paths.** k6 calls the provider's server actions by the IDs in the build's manifest, with a signed session cookie. The patient pays through the pay page's own form, posted the way it posts without JavaScript. Nothing is mocked inside the app.
- **One simulated order** is what a real one does:
  - the provider starts an order, autosaves twice and sends it
  - the patient opens the pay page and pays with 4242, which the stub approves at once, then sees the receipt
  - one order in five, the provider also loads Sales
  
  That's 7 to 8 requests per order.
- **The money is checked afterwards.** After k6 finishes, the script waits for the sweep to settle anything pending, then checks:
  - `npm run reconcile`
  - that no order has more than one charge
  - that every charge in the stub's records is a succeeded payment in the database (no paid order lost)
  - that nothing is left pending
- **The machine:** AMD Ryzen 7 7840HS (8 cores, 16 threads), 15.3 GB of RAM, Windows 11. Node 24.18, Postgres 18 in Docker 29.8, k6 2.2. k6, the app and Postgres all share this one laptop.

## Same-order race

`npm run load:race`. The setup sends one order and loads its pay page ten times, which gives ten Pay keys. Then 50 Pays go out at once, five per key. At the same moment, 20 Sends go out on one draft.

- **All 70 requests got an answer:** paid, or "We're confirming your payment".
- **One attempt saved, one charge, one succeeded payment.** The row lock and the one-live-attempt index stopped every other Pay before it reached the payment company (§5).
- **One "sent" event and one "link sent" event** for the draft sent 20 times.

The same race runs in CI, through the integration tests.

## Level 1

`npm run load:l1`: 3 orders a second for 10 minutes.

| | |
|---|---|
| Orders | 1,800 started, 1,800 paid |
| Requests | 12,948, about 22 a second |
| Failed requests | 0 |
| Time per request | median 14.8 ms · 95% within 40.0 ms · 99% within 49.9 ms · slowest 203.9 ms |
| Afterwards | 1,800 charges, 1,800 recorded payments; reconciliation clean |

The 500 ms target (D37) has about 12 times the headroom it needs on this laptop.

**What the run found.** The server's log showed one database connection closing unexpectedly while it rendered the page that follows a Send. No request failed, but it pointed at a real gap: the connection pool had no handler for a connection the database drops while it sits idle. Node treats such an event as unhandled and stops the process. The pool now logs it and carries on (D72), and the outage drill below confirms the server stays up.

## Level 2: the first thing that slows down

`npm run load:l2`: 30 orders a second for 3 minutes.

| | |
|---|---|
| Orders | about 12 a second completed. k6 couldn't start 2,105 more, because every simulated user was still waiting. |
| Requests | 21,528, about 103 a second |
| Failed requests | 0 |
| Time per request | median 7.3 s · 95% within 22.5 s · 99% within 25.0 s |
| Afterwards | 2,840 charges, 2,840 recorded payments; reconciliation clean |

**The single app server's CPU is the first limit.** CPU was sampled every few seconds during the run:

| | During the run |
|---|---|
| App server (one Node process) | 100–133% of one core: our code runs on one thread, so this is its ceiling |
| Postgres | 28–56% of one core: room to spare |

Every step slowed together, which is what queueing behind one busy process looks like:

| Step | Median | 95% within |
|---|---|---|
| Autosave | 4.5 s | 5.9 s |
| Pay | 7.0 s | 8.8 s |
| Sales page | 7.1 s | 8.8 s |
| Pay page | 9.2 s | 11.5 s |
| Receipt | 9.4 s | 11.6 s |
| Start order | 18.2 s | 22.5 s |
| Send | 20.3 s | 25.2 s |

Start order and Send are the slowest because each one also renders the page it redirects to.

The fix is the one §2 lists for Level 2: **several app copies behind a load balancer.** The database has headroom, and the sweep's advisory lock is already in the plan for a second copy.

## Level 3

`npm run load:l3`: 800 orders a second for 1 minute, with k6 capped at 2,000 simulated users so k6 itself doesn't exhaust the laptop.

| | |
|---|---|
| Orders | 2,800 started at about 31 a second. k6 couldn't start 43,893 more. 26 were paid within the minute. |
| Requests | 13,634; 3,576 failed (26%) |
| Afterwards | 43 charges, 43 recorded payments; reconciliation clean |

The failures came from two places:

| Error | Count | Where |
|---|---|---|
| "timeout exceeded when trying to connect" | 5,841 in the server's log | Requests waited more than 5 seconds for one of the pool's 10 database connections |
| Connection refused | 279 | The laptop's network stack turned k6 away |

So past the app server's CPU, the next limits are the connection pool and the machine itself. As §2 says, this run measures the laptop more than the design. The Level 3 changes (partitioned orders, several databases, a queue for payment results) are written down in §2, not built.

## Database outage drill

`npm run drill:outage` runs Level 1's rate for 4 minutes. 60 seconds in, it stops the local Postgres container (`docker compose stop db`), and 30 seconds later it starts it again.

| | |
|---|---|
| Orders | 721 started, 624 paid |
| Requests | 4,600; 97 failed (2.1%), all during the outage |
| After the restart | The server reconnected on its own and kept serving; requests succeeded again within seconds |
| Afterwards | 624 charges, 624 recorded payments, 0 double charges, nothing pending; reconciliation clean (657 paid orders, counting the seed's) |

- **The pass bar is met.** A Pay attempted during the outage failed before any charge, because the attempt couldn't be saved (§5, "Steps 2–3, database down"), so nobody was charged without a record.
- **The patient sees the pay page's error screen.** During the drill it said "We're confirming your payment. Don't pay again.", which confuses someone who only opened their link and never paid. It now says "We couldn't load this page. If you just paid, don't pay again: your payment may still be going through." (D73), which still never says "declined" (D23).
- **The sweep had nothing to repair.** With the 4242 card approving at once, the gap between charging and recording is a few milliseconds, too short to land inside the outage. That path is covered elsewhere:
  - an integration test makes the step 5 write fail after an approval and checks that the sweep records the payment
  - the 0309 slow-approve test card shows it live

## Limits of these numbers

- **One machine runs everything.** k6, the app and Postgres share the laptop, so each run competes with itself. A separate load machine would show the app's own limits more clearly.
- **The stub answers instantly.** A real payment company takes about a second per charge, which these tests don't include (D37 leaves it out on purpose).
- **The hosted demo wasn't load-tested.** Render Free and Neon Free sleep when idle and run on shared hardware, so their numbers wouldn't describe the design.
- **The single-process ceiling is our deployment, not a fixed limit.** Nothing in the app keeps state between requests (§2), so more copies scale out.
