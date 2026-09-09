# Product Lifecycle Management — design brief

Decisions taken 2026-09-09, from the Phase 0 discovery. This is the design, not
the implementation. Findings that produced it are in the appendix; every number
in this document was measured against the live database on 2026-09-09 and should
be re-measured before being acted on (see CATALOGUE.md "Number drift").

---

## The model — two layers, one spine

The single most important decision: **a product and a program are different
things, and conflating them is what the current system does wrong.**

`vessl.programs` today is quote-shaped — it carries `quote_id` plus free-text
`product`, `sku`, `client` and `factory`, and **has no `product_id` at all**. So
the only lifecycle object in the system cannot be joined to the catalogue except
by string, and it holds exactly one row.

### Product layer — one per SKU, client-agnostic

```
rules identified → materials known → tested → eFiled → active / retired
```

**Testing is a product fact, not a program stage.** A test report describes the
product; it does not describe a client relationship. Testing the same SKU twice
because two clients ordered it is the shape the current model invites and the new
one forbids.

**Sample → Production is a product transition**, PROPOSED by the system when a
passing test report lands for a product still at Sample, and CONFIRMED by a person
in one click. Not automatic: a passing test is strong evidence, not authority.
Not manual-only either: today 160 of 185 selectable products carry a declared
`product_stage` and 7 of them contradict the order record, which is what
unassisted declaration produces.

### Program layer — one per SKU-per-client

```
Inquiry → Quoted → Sampling (round N) → In production → Shipped → Delivered
```

**Sold is added to the end once `sales_order_items.product_id` exists.** It does
not exist today — 0 of 255 rows carry it — so the lifecycle currently cannot
reach Sold at all. Phase 0.5 closes that.

The same SKU quoted to two clients is ONE product and TWO programs. That is the
whole reason for two layers.

---

## Derivation — evidence wins

**Derived, never hand-set:**

| Stage | Derived from |
|---|---|
| Quoted | `quotes.created_at` / `quote_date` via `quotes.product_id` |
| Tested | `test_reports.test_date` via `test_reports.product_id` |
| In production | `purchase_orders.issued_at` / `order_date` via `purchase_order_items.product_id` |
| Shipped | `shipments.actual_departure` via `shipment_pos` |
| Delivered | `shipments.actual_arrival` via `shipment_pos` |
| Sold | `sales_order_items` — **after Phase 0.5** |

**Declared:** Inquiry (there is no record of an enquiry until a quote exists), and
sample rounds.

**Sample rounds are counted from test reports while the product is still at
Sample.** Round N is the Nth report for that product before it transitions to
Production.

**Rounds are RECORDED when counted, never recomputed.** The count stops the moment
a product reaches Production, so a rule that recomputes forever loses every
historical round the instant the transition happens. Three of the four products
with linked reports today are already at Production and their round history is
already unrecoverable for exactly this reason.

### The Sample to Production proposal, precisely

- **Fires once per NEW passing report.** Not once per render, not once per report
  already seen.
- **Records the outcome** -- accepted or declined, by whom, and when.
- **Never re-fires without new evidence.** A declined proposal stays declined
  until a report the system has not seen before arrives.

This is not hypothetical tidiness. `ee9db0fd` LLW-1545 sits at Sample with FOUR
passing reports; a naive rule would have proposed the same transition four times,
and a proposal that repeats is a proposal nobody reads.

**Conflict rule: a declared value that contradicts the evidence shows a visible
exception badge. The system never silently picks a winner.** Both values stay on
screen with their sources named. Twelve rows are in that state today and every one
of them is a real data-quality finding rather than a display problem — see the
appendix.

---

## Dropped from the old nine stages

The current `programs` model has nine: inquiry, quoting, sampling, revision,
testing, pre_production, production, shipped, delivered. Three go:

- **Revision** → becomes **Sampling round 2+**. It was never a different kind of
  work, only a later round of the same work, and modelling it separately makes
  "how many rounds did this take" unanswerable.
- **Pre-production** → a MOMENT, not a stage. Its checklist (PO issued,
  pre-production sample approved, deposit paid) is three events on the way into
  production, not a phase a product sits in.
- **Testing** → moves to the **product layer**, per above.

Kept, because they carry real meaning nothing else does: the blocker vocabulary
(`none / factory / client / us`), the per-stage default owners, and the stage
checklists.

---

## Identity problems wearing a lifecycle costume

**Of the twelve declared/derived contradictions, at least two are not lifecycle
problems at all -- they are duplicate-product problems.** The clearest is JON-106,
where the test report is attached to the retired twin while the selectable twin
declares `passed` with no evidence.

**Decision: product identity is resolved BEFORE Phase 1 renders exception
badges.** A badge that mostly says "you have two products" teaches people to
ignore badges. That makes the parked questions -- costing-basis identity
(script 14), the remaining duplicate-SKU groups, and Kristy's three product
decisions -- prerequisites of Phase 1 rather than parallel work.

## Assumptions to confirm

1. **Sample approval is per product, not per client.** If two clients each approve
   a sample of the same SKU independently, this is wrong and approval belongs on
   the program layer. Stated here so it is confirmed rather than discovered.
2. **Phase 1 warns only. Blocks arrive in Phase 2.** A derived model that starts
   by refusing saves would strand real records on day one — the same reasoning
   that kept 154 existing quotes editable when the inactive-SKU block shipped.

---

## Phases

**Phase 0.5 — plumbing.** Link `sales_order_items` to products (231 of 255 are
resolvable; see the appendix) and decide what writes `product_id` on future SO
lines so the gap cannot reopen. Not a lifecycle feature -- a prerequisite, without
which the model cannot see its own last stage.

> **The 73 orphan test reports are NOT part of Phase 0.5, and the reason matters.**
> They cannot be linked, because the products they name do not exist. Every one of
> the 73 carries a report number and a sample description, but only 2 name a SKU
> the catalogue holds. The descriptions reference codes like `LLG-1144`,
> `LLG-1511`, `LLC-1510`, `LLG-1457`, `LL1-1478` -- and NONE of those exists in
> `vessl.products`, not even as a prefix.
>
> So this is not a matching problem or a data-entry backlog. It is a catalogue
> question: an entire product line has been tested but never entered as products.
> Until that is answered, **the Tested stage on the product layer covers 4
> products**, and Phase 1 must say so rather than implying testing coverage it
> does not have.

**Phase 1 — read-only derived timeline.** One view per product showing derived
events with their sources, and exception badges where declared and derived
disagree. No writes, no blocks. It earns trust by being right about the past
before it is allowed to constrain the future.

**Phase 2 — the program entity.** Replaces `vessl.programs`, keyed on
`(product_id, client)` rather than free text. Declared stages, sample rounds, and
**structured factory progress** — which fixes the defect below.

> **The prose-crush in the import path.** The weekly factory sheet asks for
> `% Complete` and `Expected Ship / Ready Date` in their own columns, and the
> import writes only `stage` to a column. Percentage, date and note are
> concatenated into one `program_notes` string with ` · ` separators. Structured
> data the factory typed into structured cells is destroyed into prose on the way
> in, every week. Phase 2 gives those two values columns.

**Phase 3 — automation.** Cross-layer gates (a program cannot enter production
while its product has no passing test), and per-person next-action queues
delivered in the Monday-digest pattern the RFQ digest established — weekly,
bucketed by urgency, silent when there is nothing to say.

---

# Appendix — Phase 0 discovery findings

Measured 2026-09-09.

## A. The twelve declared/derived contradictions

Of 185 selectable products, twelve carry a declared value the evidence
contradicts. Categories overlap; twelve distinct rows.

| Contradiction | Rows |
|---|---|
| `product_stage = production`, never ordered | 4 |
| `product_stage = sample`, already ordered | 3 |
| `compliance_status` compliant/passed, no linked test report | 4 |
| eFiled date set, no linked test report | 1 |
| Ordered but never quoted | 1 |

**Some of these resolve themselves once Sold is derivable.** Three of the four
`product_stage = production, never ordered` rows -- `006511ac` CHP PT Tee,
`2e99645b` CHP Sweatpants Blanks and `5f81fbe8` CHP Sweatshirt Blanks -- DO have
sales order lines. They were sold; they simply have no purchase order, because
they are blanks bought rather than manufactured. Under a model whose only evidence
of "in production" is a PO, they read as contradictions. Under a model that can
see Sold, they read correctly. **A derived model with a missing edge does not
report an unknown, it reports a false contradiction** -- which is its own argument
for finishing Phase 0.5 before Phase 1 renders badges.

**The clearest one, and the argument for the whole project.** SKU `JON-106`
exists twice. `61d55187` "Wine Chiller" is **retired** and holds the only JON-106
test report. `138427ce` "Wine Container White" is **selectable**, declares
`passed`, carries an eFiled date of 2026-08-19 — and has no report at all. The
evidence sits on the retired twin. Nothing in the app shows this.

## B. The 21 lifecycle-less products

21 of 185 selectable products have **no quote, no order and no test report** — no
lifecycle event of any kind. They overlap the 23 unquoted products recorded on the
§6 board in CATALOGUE.md, which are invisible on the Products page because that
page renders from quotes. A lifecycle view is the first screen that would show
them.

## C. Derived stage distribution, 185 selectable products

| Derived stage | Products |
|---|---|
| no quote, no order, no test | 21 |
| quoted only | 125 |
| quoted and tested, never ordered | 2 |
| ordered, never tested | 32 |
| ordered and tested | 1 |
| shipped, not landed | 0 |
| landed | 4 |

79% sit at "quoted or less". The model is feasible and front-loaded; it mostly
shows that the catalogue has not moved.

## D. The data map

| Table | Rows | Product-linked | Lifecycle edge |
|---|---|---|---|
| `quotes` | 331 | 328 | Quoted |
| `programs` | **1** | none — `quote_id` only | Sampling intent |
| `test_reports` | 84 | **11** | Tested |
| `product_regulations` | 170 | yes | Rules identified |
| `product_materials` | 7 | yes | Composition |
| `compliance_tasks` | **0** | — | unused table |
| `purchase_order_items` | 254 | 94 | Ordered |
| `purchase_orders` | 67 | via items | PO issued |
| `shipment_quotes` | 13 | — | Freight RFQ |
| `forwarder_bids` | 1 | — | Freight bid |
| `shipments` | 32 | via `shipment_pos` | Shipped / Landed |
| `sales_order_items` | 255 | **0** | Sold — unreachable |
| `inventory_balances` / `inventory_lots` / `stock_movements` | 0 / 0 / 0 | — | unused tables |

`products.updated_at` is advanced on 2 of 351 rows and is unusable as evidence of
anything.

## E. The 0-of-255 gap

No sales order line links to a product. The FK exists; no code path writes it. SO
creation and the SO editor write `description` and `client_sku` as free text. The
lifecycle therefore ends at Delivered, and revenue cannot be attributed to a
product by anything but a string.

Phase 0.5 measured the repair: **49 rows resolve exactly via `quote_id` →
`quotes.product_id`**, 78 more match exactly one selectable product by SKU, 1 is
ambiguous, 123 match only retired products, and 4 match nothing.
