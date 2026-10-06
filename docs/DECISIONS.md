# Decisions

Key decisions, why we made them, and what they cost. A new decision is added here in the same commit as the work it affects. The design these decisions shape lives in [ARCHITECTURE.md](ARCHITECTURE.md).

Status is **Accepted** (agreed with the user), **Proposed** (awaiting the user), or **Superseded** (replaced; the entry stays and points to its replacement).

## Decision log

| # | Decision | Why | Trade-off | Status |
|---|---|---|---|---|
| D1 | Split per item = COGS + provider margin + 75 bps fee. No platform markup. | PRD requirement 3; the PRD's metric is "the 75 bps we earn". | The fee is our only revenue, and real card fees are larger than it. | Accepted |
| D2 | The fee is 0.75% of the full item price, built into the price, and never shown to the patient as its own line. | The patient pays exactly the price the provider set (requirement 1). COGS is fixed and brands can't be charged. A visible fee on a clinician's recommendation costs trust for 27¢. | The provider's share absorbs the fee unless they raise the price. | Accepted |
| D3 | No-profit means a $0 margin at the lowest price (COGS $20 → $20.15). The platform keeps nothing extra. | The PRD has no platform markup. It beats Fullscript's $26 (full discount) and $36 (no-profit default). | We give up a Fullscript-style spread. | Accepted |
| D4 | Integer cents. The fee is rounded once per item, and the margin is computed by subtraction. | Every cent is traceable and the parts always add up. | The order's fee can differ from 0.75% × order total by up to ½¢ per item. | Accepted |
| D5 | The provider can enter a price or a margin. The margin is recomputed from the final price. | Requirement 1 allows either, and the fee depends on the price. | The margin can be 1¢ off what the provider typed. | Accepted |
| D6 | The patient pays for the exact order and can't add items. | Browsing is out of scope, and requirement 1 has the provider assemble the order. | No patient self-service. | Accepted |
| D7 | Providers keep an item list drawn from a shared seeded catalog. No stock tracking. | The user's reading of requirement 5 ("update inventory" means which items the provider sells). | We can't stop someone selling an item we're out of. | Accepted |
| D8 | Every paid order placed with us counts as volume moved off third-party sites. | The PRD says the volume already exists. | It also counts orders that are new, not moved (see Known limitations in ARCHITECTURE.md). | Accepted |
| D9 | Shipping, tax, real card fees, and refunds are out of the slice. | The PRD puts them out of scope. | The real economics aren't modelled. | Accepted |
| D10 | The provider can change an item's price on any order. It starts at their usual price. | Changing the usual price for one patient and then changing it back adds friction for our main user. | Prices can differ between patients of the same provider. | Accepted |
| D11 | The product is a provider portal (My store, New order, Sales, Order details) plus one patient checkout per order, presented as the provider's store. | Requirement 1 has the provider assemble the order, and this ties each payment to a patient. A shared store link couldn't do that, and anyone holding it could buy. | The patient can't add items. | Accepted |
| D12 | We polish the UX, including product images, beyond what the PRD asks, but only on New order and Checkout. | The user is a front-end engineer and wants a good experience. The graders don't score visual design, and we have 1–2 days. | Time spent on UI isn't spent elsewhere. | Accepted |
| D13 | The margin is paid to the provider. Each provider belongs to a practice. | The PRD says to "route the provider's margin to the provider". | Payouts to a practice aren't supported yet. | Accepted |
| D14 | Prices are capped at MSRP. | It protects patients, and prices across providers can only vary downward. | Providers can't charge above retail. | Accepted |
| D15 | The demo uses real brand and product names with real retail prices, our own illustrated images, a "Demo — not a real store" notice, and is hidden from search engines. | Real names make it feel realistic. Brand photos carry copyright risk on a public URL and repo; the worst realistic outcome is a takedown request. | The images don't match the real packaging. | Accepted |
| D16 | Each item in My store has a saved usual price that pre-fills new orders. | It saves the provider clicks. | One more field per store item. | Accepted |

## Assumptions

- **A1:** Today, providers pay practitioner prices (about half of retail) through programs that ship single orders to the patient, such as Emerson Ecologics patient orders and Thorne's practitioner program. Reasons: professional brands sell mainly to licensed practitioners and restrict Amazon sales; the PRD's workflow (order placed for the patient, shipped to the patient, provider pays at checkout) matches these programs; and a provider is unlikely to pay retail when a practitioner price is available. The PRD doesn't say. This only affects the comparison in the write-up.
- **A2:** The hosting budget and host are decided in the architecture step.

## Cut, and what's next

| Cut | Why | Next, with more time |
|---|---|---|
| Refunds | Out of scope for the slice (user decision) | Reverse the split. The provider's margin is clawed back. Stripe keeps its processing fee on refunds. |
| Refills / autoship | The slice is a single order | Repeat orders on a schedule, possibly with a small discount (Fullscript uses 5%). |
| Patient browsing | Out of scope (PRD) | Let patients browse the provider's store, limited to items the provider allows. |
| Shipping charge | Out of scope (PRD) | Patient pays shipping below a threshold, with free shipping above about $50. Our estimate: a $0-margin order breaks even at about $46 when we pay shipping. |
| Real payments and payouts | Out of scope (PRD) | A Stripe Connect-style setup: we take the charge, then transfer the margin to the provider's connected account. |
| Payee onboarding | Payouts are stubbed | Collect tax details and a bank account, needed only for providers who earn a margin. |
| Practice-level payouts | D13 | Payouts to a practice's account, with each order credited to the recommending provider. |
| Sales tax | Out of scope (PRD) | Calculate and collect tax per state. |
| Stock tracking | D7 | Reduce stock when an order is paid, and stop sales when an item runs out. |
| Pricing-policy review | Regulatory is out of scope | Review brand advertised-price policies (MAP) and FTC rules on comparing to suggested retail prices before showing savings publicly. |
| Measuring % of volume moved | D8 | Ask providers at sign-up how much they spend on third-party sites each month. |
| Card-fee economics | Payments are stubbed | Decide who covers the ~3% card fee, which is larger than the 75 bps. |
