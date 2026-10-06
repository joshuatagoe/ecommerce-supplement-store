# Users

Who this product is for, what they need, and how they move through it. Prices use one running example: a bottle with a $40 retail price that costs us $20. The money model is in [ARCHITECTURE.md](ARCHITECTURE.md#money-model), and the decisions referenced as D1–D16 are in [DECISIONS.md](DECISIONS.md).

## Summary

Clinical providers recommend supplements as part of treatment, but buying them for patients today means fronting the money, chasing reimbursement, and working outside the EHR. We let a provider build the order inside our product and send it to the patient, who pays us directly. The provider's margin comes to them automatically, and every cent is recorded.

## Who we serve

| User | Role | In the slice |
|---|---|---|
| **Provider** | Recommends supplements, builds the order, earns the margin. **Primary user.** | Yes |
| **Patient** | Receives the order link and pays. | Yes |
| **Practice** | The clinic a provider belongs to. | Recorded on each order through the provider; not a separate user |
| **Platform (us)** | Holds the stock, takes the 0.75% fee, audits the money. | Order details and totals check; no separate admin product |
| **Brands** | Make the supplements. We buy stock from them in advance. | Not users. They appear only as item cost (COGS). |

## Provider (primary user)

Providers are the reason this works: they bring the patients, so provider engagement drives every sale. When a choice trades provider time against something else, provider time usually wins.

**Context.** A busy clinic. The provider (or a staff member acting for them) recommends supplements during or after a visit. Supplements are often an ongoing protocol, not a one-off.

### Two kinds of provider

| | Margin seller | At-cost / no-profit provider |
|---|---|---|
| **What they do today** | Buys at the practitioner price (~$20) and charges the patient about retail ($40) | Passes the practitioner price straight to the patient (~$20) |
| **How common** | Just over a third marked up 1.8× or more (NBJ 2012 survey, secondary source) | About a quarter sold at 1.0–1.1× cost (same survey) |
| **Why** | Supplements are real income; about 31% of practitioners in one survey said they're over 20% of income | Ethics guidance: the AMA's Code of Medical Ethics (Opinion 9.6.4) encourages selling at cost and requires disclosing any financial interest |
| **What they compare us on** | How much they earn per order | What their patient pays |
| **What they need from us** | Their margin, paid automatically, with no chasing | The lowest possible patient price, with no setup and no seller paperwork |

Both kinds use the same product. A $0 margin is just a price set at the lowest allowed price (D3).

### Pains today

- **Fronting money.** The provider pays ~$20 per bottle at checkout and waits to be paid back.
- **Chasing payment.** In 2026, 70% of providers needed two or more statements to collect a patient balance in full (J.P. Morgan Payments / InstaMed).
- **Staff time.** Ordering, invoicing, and recording payment take about 10 minutes per order. That's our estimate, still to be checked with real practices. At $28–$33 an hour fully loaded for office staff (BLS), that is about **$5 per order**.
- **Shipping and collection costs.** $0 to $11.85 per patient shipment depending on the supplier, plus about $1.62 in card fees to collect $40 by invoice.
- **Nothing is recorded.** The purchase never reaches the chart or the practice's books.

### What success looks like

- Providers create orders often: orders per provider and active providers per week go up.
- Building an order is fast: we track the time from starting an order to sending it.
- Patients pay quickly: we track the time from sending to payment.

## Patient

**Goals.** Stay on the protocol their provider recommended. Pay easily. Trust that the price is fair.

**Needs.**
- A link that works on a phone, with no account to create.
- Clear information: who recommended this, what each item is, what it costs, and how much they save against retail.
- No surprise fees. The price shown is the price paid; the 0.75% fee is built in (D2).
- An accessible page (see Accessibility needs).

**Constraints.** Patients may be older, unwell, have low vision, or be using an old phone on a slow connection. They are buying because their clinician recommended it, so the page should feel like it comes from their provider, not a marketplace.

**What they can't do in the slice.** Add or remove items, or browse the store (D6). They pay for the order their provider built.

## Practice (secondary)

Each provider belongs to a practice, and each order records it. That makes practice totals possible later, which is what the PRD means by "the practice's financial system." In the slice, payouts go to the provider (D13).

## Platform (us)

We need to look at any paid order and see exactly where every cent went (PRD requirement 4), and to total GMV, fees, and provider engagement. In the slice that is the Order details view, plus a totals check that confirms every paid order adds up.

## Today vs. with us

| Step | Today | With us |
|---|---|---|
| Recommend | Provider chooses supplements, then leaves the EHR for a supplier site | Provider builds the order inside our product from their store |
| Order | Provider (or staff) places the order on the patient's behalf | Provider sends the patient a link |
| Pay | Provider pays the supplier up front | Patient pays us directly |
| Reimburse | Provider invoices and chases the patient | None needed |
| Margin | Provider keeps whatever the patient pays back, if they pay | Provider's margin is recorded at payment and paid out to them |
| Records | Nothing in the chart or the books | Order, payment, and split recorded |

### The $40 bottle

**A margin seller, patient pays $40:**

| | Wholesale today | Fullscript | Us |
|---|---|---|---|
| Provider pays up front | $20 + $0–$11.85 shipping | $0 | $0 |
| Provider's cost to collect | ~$1.62 | — | — |
| Provider's staff time | ~$5 | None | None |
| **Provider earns** | **~$1.50–$13.40**, if the patient pays | **$14.00** | **$19.70** ($40 − $20 cost − $0.30 fee) |

**An at-cost provider, earning $0:**

| | Patient pays |
|---|---|
| Wholesale at cost (today) | ~$20 + shipping, plus ~$5 of the practice's unpaid staff time |
| **Us** | **$20.15** ($20 cost + $0.15 fee) |
| Fullscript, full discount | $26 (the provider must register as a seller, with tax ID and bank account) |
| Fullscript, no-profit default | $36 |

Our wholesale comparison assumes today's providers pay practitioner prices (assumption A1). It also assumes our cost equals the practitioner price. If our real cost is lower, every "Us" number improves.

## UX flows

Each flow lists its steps and then what happens when something goes wrong.

### F1 — Provider sets up My store

1. Open **My store**. See the catalog: each item's name, image, our cost, lowest price, and highest price (retail).
2. Add an item to the store.
3. Set a **usual price** (D16). As they type, they see "You earn $X" and "Patient saves $Y vs retail". A **No profit** button sets the price to the lowest allowed.
4. Save.

Things that can go wrong:
- **Price below the lowest price.** Rejected, with the message: "The lowest price for this item is $20.15. Below that you would lose money."
- **Price above retail.** Rejected, with the message: "The highest price is the retail price, $40.00" (D14).
- **Item removed from the store later.** Orders already sent keep it at the price they were sent with.
- **Empty store.** New order sends the provider to My store first.

### F2 — Provider creates an order and sends the link

1. Open **New order** and choose a patient (from the EHR; seeded in the slice).
2. Pick items from My store. Each starts at the usual price (D10).
3. Change a price or margin for this patient if needed (D5). Each line shows the price, "You earn", and the saving vs retail. The order shows a total and the provider's total earnings.
4. Review, then **Send**. The order locks. We create a link with an unguessable code.
5. The link is "sent" to the patient. Email is stubbed, so the provider can also copy the link.

Things that can go wrong:
- **Out-of-range price on one line.** That line shows the allowed range, and Send is disabled until it's fixed.
- **Double-clicking Send.** Exactly one order is created.
- **Mistake after sending.** A sent order can't be edited. Proposed for the architecture step: the provider can cancel an unpaid order and create a new one.
- **Catalog or store price changes after sending.** The sent order keeps its prices.

### F3 — Patient pays

1. Open the link on any device. No login.
2. See a checkout that looks like the provider's store: "Recommended by Dr. [name]", each item with image, price, retail price struck through, and the saving, then the total. A "Demo — not a real store" notice is visible.
3. Enter card details. Payment is stubbed.
4. **Pay**, then a confirmation with the items, total paid, and an order reference.

Things that can go wrong:
- **Card declined.** A plain message: nothing was charged, try another card. The order stays unpaid.
- **Double-clicking Pay, or two tabs.** Only one payment can succeed (enforced on the server, not just by disabling the button).
- **Unclear result** (e.g. timeout). The patient sees "We're confirming your payment" and the order goes to **needs review**. It is never retried automatically as a new charge.
- **Link reopened after payment.** "Already paid", with the receipt.
- **Cancelled order.** "This order is no longer available. Please contact your provider."
- **Wrong or made-up link.** A generic "not found" page that reveals nothing about other orders.

Privacy:
- The link contains no product names or patient details.
- The page shows only this order.

### F4 — Provider checks Sales

1. Open **Sales**. See orders with patient, date, status in words (Sent, Paid, Needs review, Cancelled), total, and "You earned".
2. See this month's totals: sales, earnings, and fees.
3. Open any order to see its details (F5).

Edge cases:
- **No orders yet.** An empty state that links to New order.
- **Other providers' orders.** Never shown.

### F5 — Audit a paid order

1. Open **Order details** for a paid order.
2. Per item: the price, our cost, the 0.75% fee, and the provider's margin. The three parts add up to the price.
3. Order totals, the fee rate used, the created, sent, and paid times, and the payment reference.

**Who sees it.** The provider, for their own orders. Internally, the same view plus the totals check across all paid orders.

**Edge case.** An order whose parts don't add up can't be saved: the database refuses it. If one somehow existed, the totals check would flag it.

## Accessibility needs

The target is WCAG 2.2 AA (the Web Content Accessibility Guidelines), checked with the axe tool and a keyboard-only run-through.

**Patient checkout (highest priority):**
- Works with only a keyboard and with a screen reader. Every field has a visible label.
- Text contrast of at least 4.5:1. Large tap targets. Usable at 200% zoom and on a small phone.
- Status is shown in words, not only colour ("Paid", not just a green dot).
- Errors are explained in plain words next to the field, and announced to screen readers.
- Prices are read correctly ("$36.00"). The struck-through retail price is announced as "retail price $40.00", not just read as a crossed-out number.
- Images have alt text, e.g. "Magnesium Glycinate, 120 capsules".
- No time limits on the payment form.

**Provider portal:**
- Keyboard-friendly forms and tables, clear focus outlines, and errors tied to their field.
- Live "You earn" figures update without stealing focus.

## Research basis

Researched 2026-10-05. "Secondary" means the claim came from a reliable report rather than the original source.

- **Fullscript**, the market leader (135,000+ practitioners, secondary):
  - Free to practitioners ([pricing](https://fullscript.com/pricing)).
  - The patient pays retail minus a discount. Up to 35% of retail in the US is split between the provider's margin and the patient's discount ([profit dispensaries](https://support.fullscript.com/articles/profit-dispensaries), [patient discounts](https://support.fullscript.com/articles/dispensary-individual-patient-discounts/)).
  - The no-profit default gives patients a fixed 10% off, the provider earns $0, and Fullscript is the seller ([no-profit](https://support.fullscript.com/articles/no-profit-dispensaries)).
  - Payouts every 30 days to the clinic owner ([payouts](https://support.fullscript.com/articles/receiving-your-payouts-profit-dispensaries-only)).
  - Patients pay $8.75 shipping under $50 ([shipping](https://support.fullscript.com/articles/patient-shipping-policy)).
  - 40+ EHR integrations ([integrations](https://fullscript.com/en-US/integrations)).
  - Its wholesale service ships only to practices ([wholesale addresses](https://support.fullscript.com/articles/wholesale-shipping-address-requirements)).
- **Thorne:**
  - Practitioner program with free shipping to patients and a 15% platform fee on wholesale ([build your practice](https://www.thorne.com/build-your-practice)).
  - Its MAP policy bans advertising prices below its minimum ([MAP policy](https://www.thorne.com/map-policy)).
  - It bans unauthorized marketplace resale ([resale policy](https://www.thorne.com/authorized-resale-policy)).
- **Practitioner pricing:**
  - About 50% off retail (Pure Encapsulations, secondary: [exhibitor sheet](https://ce.mayo.edu/sites/default/files/media/2024-02/2402_PE_BenefitOP_Mayo.pdf)).
  - "Wholesale" here means the licensed-practitioner price, not bulk buying.
  - Emerson Ecologics charges $5.75 shipping plus a $6.10 fee to ship to a patient ([shipping policy](https://help.emersonecologics.com/articles/emerson-ecologics-shipping-policy); its pages contradict each other).
- **How providers price:**
  - NBJ 2012 survey of 500+ practitioners (secondary: [New Hope](https://www.newhope.com/vitamins-and-supplements/nbj-practitioner-survey-integrative-medicine-no-longer-the-alternative)).
  - AMA Opinion 9.6.4 ([PDF](https://code-medical-ethics.ama-assn.org/sites/default/files/2022-08/9.6.4.pdf)).
- **Staff cost:**
  - BLS May 2025 median wages in physician offices: $19.01–$22.87 an hour for receptionists, medical secretaries, medical assistants, and billing clerks ([OEWS](https://www.bls.gov/news.release/ocwage.t01.htm)).
  - Wages are about 70% of total compensation ([ECEC](https://www.bls.gov/news.release/ecec.t04.htm)).
  - Collection data: [J.P. Morgan Payments 2026](https://www.jpmorgan.com/payments/newsroom/trends-healthcare-payments-2026).
- **Card fees:** 2.9% + 30¢ for standard online cards ([Stripe pricing](https://stripe.com/pricing)).

## Assumptions to validate with real practices

- How many staff minutes a supplement order takes today, and how many follow-ups an unpaid order needs.
- The share of providers who sell at cost versus mark up, by provider type (MD, naturopath, chiropractor, dietitian).
- Which ordering channels they use today, and the price they pay (assumption A1).
- Whether patients complete payment from a link without a reminder.
