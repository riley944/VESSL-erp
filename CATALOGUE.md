# Products catalogue — session notes

Opening evidence for the catalogue-cleanup session. Everything below was measured
against the live database on **2026-08-28**. Re-measure before acting: see
"Number drift" at the end for why that is not optional.

---

## 0. Case study — the BUC-157 rename (2026-08-28)

**The canonical propagation case.** A customer asked for one SKU to change. It
was edited by hand on three screens by two people. Two edits landed, one did
not, and a fourth variant was created in the process. Nobody could have known
without a database sweep.

> "if I have to update information on multiple screens, it allows more chance
> for me to miss something."
> — Kristy, Director of Ops

### What was asked

Customer asked that `BUC-157` become **`BUC-157 KU2607001`**.

### Status: FULLY CLOSED 2026-08-31 — `scratchpad/15` then `scratchpad/20`

Script 15 (2026-08-28 22:17 UTC) renamed three rows: `products.sku`, which was
still the bare `BUC-157`; and the quote and SO line, normalising Kristy's
double-spaced value. Script 20 (2026-08-31) linked the last row — the draft PO
line on `KUI-SO-2026-013` — to the product, which script 15 had deliberately left
alone as "a new decision, not part of this rename". Verified after commit: line
`3b753125` carries `product_id c8f3d2d2` and `product_sku 'BUC-157 KU2607001'`,
stamped by the trigger rather than by the script, and the PO is still a draft.
That line previously printed **no SKU at all**, so this is an addition to an
unissued document, not a rewrite of an issued one.

Four BUC-157 items remain and none is a script: duplicate product `6f92c254`
(`BUC_157` / `CO BAG`, underscore variant), the stale duplicate quote `3bc2833a`,
program `576b59d8` tracking the underscore variant, and quote `56a08f12`, whose
product name has drifted from this product's `CO bag` — it is one of the three
listed for Kristy in §6.

**Correction to an earlier status, and where it came from.** A status of
"completed / 2 rows updated / fully verified" reached this session and was
wrong on every count: `vessl.products.sku` was still the bare `BUC-157`, the two
rows that *had* been edited both carried an undetected double space, and nothing
had been checked against the database. Script 15 updated **three** rows, not two.

That status originated in the **chat-side handoff summary** — the layer that
condenses a session for the next one. It did not come from Kristy and it did not
come from Claude Code. **Kristy's edits landed exactly where she said they did**,
on the quote and on the SO line; her only defect was a double space no interface
could have shown her. The summary turned "two screens were edited" into "the
rename is complete and verified", which nobody had claimed and no query
supported.

### What actually happened, per the data

| # | Location | Value before | Who / when | State |
|---|---|---|---|---|
| 1 | `vessl.products` `c8f3d2d2` | `BUC-157` | never modified | was **STALE** → fixed by script 15 |
| 2 | `vessl.quotes` `56a08f12` | `BUC-157␣␣KU2607001` | kristy@ 21:33 | landed, double space → normalised |
| 3 | `vessl.sales_order_items` `d1d0f5f7` | `BUC-157␣␣KU2607001` | kristy@ 18:54 | landed, double space → normalised |
| 4 | `vessl.quotes` `3bc2833a` | `BUC-157` | loren@ 2026-07-23 | stale duplicate quote — **still open** |
| 5 | `vessl.products` `6f92c254` | `BUC_157` / "CO BAG" | never modified | duplicate product — **still open** |
| 6 | `vessl.programs` `576b59d8` | `BUC_157` ×2 | 2026-08-26 | underscore variant — **still open** |
| 7 | `vessl.purchase_order_items` `3b753125` | `master_sku` NULL | PO draft | carries no SKU at all — no action |

Before the fix, **four distinct strings existed for one product**: `BUC-157`,
`BUC-157␣␣KU2607001`, `BUC_157`, and the intended `BUC-157␣KU2607001` — which
existed nowhere.

Rows 1–3 now all read `BUC-157 KU2607001`, length 17, single space. Verified
outside the transaction after commit: 0 double-space forms remain,
`count(distinct)` across the three = 1, and rows 4–6 confirmed untouched.
**Rows 4–6 remain open** — they are decisions about which quote and which
product are real, not string fixes, and belong to the catalogue session.

### The three failures, each a different mechanism

1. **The product edit did not land.** `vessl.products.sku` was still exactly
   `BUC-157`, and no product row contained `KU2607001`. Note `updated_at` could
   not corroborate this either way — it is never advanced on this table (§4) —
   so the *value* was the only evidence. **A save that silently does nothing is
   indistinguishable from a save that worked.**
2. **A double space nobody can see.** Kristy typed `BUC-157␣␣KU2607001`
   (length 18). The intended value is length 17. The two would never match, and
   the difference is invisible in every UI. Both of the edits that *did* land
   carried it.
3. **Nothing propagated because nothing is linked.** The SO line has
   `product_id` NULL *and* `quote_id` NULL. The PO line has `product_id` NULL.
   There was no path for the rename to travel — which is §4's 419 unlinked
   lines, met in the wild.

### Why the SO PDF "didn't carry it"

Kristy's read was that the quote edit failed to reach the SO. It did not fail —
`sales_order_items.client_sku` is a **snapshot**, written once at SO creation
(`page.jsx:1783`) and never re-read from the quote. There is no code path that
would ever have carried it. Her manual fix was not a workaround for a bug; it
was the only mechanism that exists.

### What this case establishes

- The propagation feature Kristy asked for would have prevented **one** of these
  three failures (#3). It would not have caught the silent save (#1) or the
  double space (#2).
- A save-confirmation and a whitespace-normalising SKU input are cheaper than
  propagation and would have caught two of the three.
- **A fourth failure, in the reporting layer rather than the product: the
  rename was summarised as done when it was not.** Two of three edits had
  landed, both with a defect, and the third had silently failed — yet the
  handoff summary said complete and verified. This one is not a UI problem and
  not a user error: **no operator overstated anything.** A summarisation step
  compressed "two screens were edited" into "the rename is finished", and the
  claim survived into the next session with no query behind it. Treat any
  inherited status as a hypothesis and re-measure; §"Number drift" is the same
  lesson from a different angle.
- The product-side version of the same lesson still stands: no screen in the app
  can show you the other two screens, so "I updated it" is a true claim about
  one row that gets *heard* as a claim about the product. Any future propagation
  feature should report **what it changed, by row**, rather than that it
  succeeded — both to the operator and to whatever reads its output later.
- `scratchpad/15-buc157-sku-rename.sql` finished the rename on 2026-08-28:
  three rows updated, all normalised to the single-space form, rows 4–7 left
  alone as decisions for Kristy. It was safe to run because product `c8f3d2d2`
  has zero linked order lines, so the live-SKU read at `page.jsx:2518`/`:2651`
  had nothing to re-render and no issued document changed.

---

## 1. The real schema

Order lines link to products by **`product_id uuid`**, a UUID foreign key. There is
no SKU-string join anywhere, and no `product_sku` column exists in any table in any
schema.

### `vessl.purchase_order_items` — 15 columns

```
 1 id                uuid  NOT NULL  gen_random_uuid()
 2 purchase_order_id uuid
 3 product_id        uuid            ← the join key
 4 description       text            ← snapshot of products.name at pick time
 5 quantity          numeric
 6 unit_price        numeric   0
 7 currency          character 'USD'
 8 ci_value          numeric         ← copied from a prior PO line, not from products
 9 carton_info       text            ← copied from a prior PO line, not from products
10 vpn               text
11 master_sku        text
12 pack_sku          text
13 baby_sku          text
14 retail_price      numeric
15 size              text
```

### `vessl.sales_order_items` — 11 columns

```
 1 id             uuid  NOT NULL  gen_random_uuid()
 2 sales_order_id uuid
 3 product_id     uuid             ← the join key; NULL on every row (see §4)
 4 description    text
 5 quantity       numeric
 6 unit_price     numeric   0
 7 currency       character 'USD'
 8 client_price   numeric
 9 client_sku     text             ← the CLIENT's SKU, not products.sku
10 quote_id       uuid
11 size           text
```

### Constraints that govern any repair

```
purchase_order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES vessl.products(id) ON DELETE RESTRICT
sales_order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES vessl.products(id) ON DELETE RESTRICT

purchase_order_items_purchase_order_id_product_id_key
  UNIQUE (purchase_order_id, product_id)      ← see §5, this one bites
sales_order_items_sales_order_id_product_id_key
  UNIQUE (sales_order_id, product_id)

products_sku_name_key
  UNIQUE (sku, name)      ← permits one SKU under many names; this is how drift got in
```

**Orphaned `product_id` values are structurally impossible.** `ON DELETE RESTRICT`
makes Postgres refuse to delete a product any order line references — that is the
error `testing.jsx:656-664` catches as `23503` to show "product in use". A rename
cannot break the join either: editing `sku` or `name` leaves the UUID untouched.
Measured orphans: **0** on both tables.

---

## 2. Render path — snapshot-first, with one exception that gates everything

PO detail fetches `select('*,products(sku,name)')` (`page.jsx:2328`) and renders:

```js
// page.jsx:2649
{it.description || it.products?.name || '—'}
// page.jsx:2651
{it.products?.sku && <div …>SKU: {it.products.sku}</div>}
```

`description` wins; the product join is a fallback only. Since `description` is
populated on **253 of 253** rows, the join is never consulted for the description.

**A blank line description cannot be produced by this path.** For one to appear a row
would need empty `description` AND no linked product — 0 rows qualify. Measured
`blank_description`: **0**, both tables. Backfilling `product_id` therefore repairs
no visible defect.

### Precedence is inconsistent across the app

| Site | Expression | Winner |
|---|---|---|
| `page.jsx:158` PO card search text | `products?.name \|\| description` | live |
| `page.jsx:956-957` products-by-order rollup | `products?.name \|\| description` | live |
| `page.jsx:1333-1334`, `1422`, `2649`, `6018` | `description \|\| products?.name` | snapshot |
| **`page.jsx:2518`** PO **document** `sku` | `it.products?.sku \|\| ''` | **live, NO fallback** |
| **`page.jsx:2651`** PO detail SKU line | `it.products?.sku` | **live, NO fallback** |

### Why 2518/2651 gate any backfill

Those two read `products.sku` live with no snapshot fallback. Two consequences:

1. **Today:** editing a product's SKU silently rewrites the SKU on every
   already-issued PO document for that product. Unintended propagation, on the
   factory-facing surface, that nobody chose.
2. **On backfill:** setting `product_id` makes a SKU line *appear* that is not
   displayed today. The four rows in script 14 would print `BGRHJC-Landed` ×3 and
   `BGLHAC-EXW` — internal costing-basis labels, not factory SKUs — onto a document
   a factory reads.

**Fix `it.master_sku || it.products?.sku` at both sites BEFORE any `product_id`
backfill.** This is a small, self-contained correctness fix worth shipping on its
own merits, independent of the catalogue work.

---

## 3. Prior work — `scratchpad/backfill-poi-product-id.sql`

An earlier session already wrote and, on the evidence, **committed** a backfill.
Its rule: line `description` = product `name`, trimmed, case-insensitive, applied
only where exactly one product matches, minus same-PO collisions.

Evidence it ran: all 88 currently-linked PO rows have `description` matching
`products.name` **exactly (88 of 88)**. That is what the rule produces, and nothing
in the app does it — the picker sets `desc = p.name` at pick time but users edit
freely afterwards.

That script's own header records the failure it was written to replace: an earlier
version matched the PO's `source_quote_id` to a product and stamped it on every
line. PO 51426 has 57 lines across 13 garments and one source quote naming a tee —
every line would have become that tee. The UNIQUE constraint rejected it on row 2,
which is the only reason it was caught.

**Read that file before writing anything new.** It is the record of two failure
modes already discovered the hard way.

---

## 4. True census — measured 2026-08-28

### Linkage

| | rows | linked | unlinked | orphan FK | blank description |
|---|---|---|---|---|---|
| `purchase_order_items` | 253 | **88** | **165** | 0 | 0 |
| `sales_order_items` | 254 | **0** | **254** | 0 | 0 |

**No sales order line in the system links to a product.** The FK exists; no code
path writes it. The only `product_id` writes in the repo are `page.jsx:2891` and
`page.jsx:5217`, both `purchase_order_items`. SO creation (`page.jsx:1783`) and the
SO editor (`page.jsx:2025-2026`) write `description` and `client_sku` as free text.

> Post-script-14 the PO figures become **92 linked / 161 unlinked**. Script 14 is
> deferred, so **88 / 165 is the current state.** Do not quote 92/161 as present tense.

> **Superseded 2026-09-04.** Both figures above are 28 Aug measurements and script
> 33 has since linked five more rows. Measured directly after 33 committed:
> **254 rows, 94 linked / 160 unlinked, 94 stamped.** The 74 / 78 / 13
> resolvability split below is likewise a 28 Aug snapshot and has not been
> re-measured since. Re-count before quoting any of it.

### Resolvability of the 165 unlinked PO rows, by description

```
 74  match no product
 78  AMBIGUOUS — description matches several products
 13  match exactly one   →  9 blocked by the UNIQUE constraint (§5), 4 actionable
```

### Resolvability of the 254 unlinked SO rows

```
by description →  12 no match | 156 exactly one |  86 ambiguous   (39% unusable)
by client_sku  →  25 no match | 200 exactly one |  29 ambiguous   (21% unusable)
```

Text matching cannot close the SO gap. A wrong guess is worse than the current NULL,
because it attaches a line to the wrong product and then propagates to it.

### Catalogue quality

```
278  products
 30  SKU values duplicated, spanning 63 rows   (23% of the catalogue)
 27  case-insensitive duplicate names
  1  product with NULL sku
243  with active NULL, 3 with active false
```

Real groups:

```
LL1-1591 → "Olivia small water bottle" | "Ollie small water bottle" | "Youth steel water bottle"
LL1-1629 → "lg minecraft reuse bag" | "Sm Minecraft reuse bag" | "XL Minecraft reuse bag"
LL1-380  → three rows, size baked into the name, one SKU
BUC-152  → "COOLER WITH SHORTER STRAPS" | "COOLER WITH SHORT STRAPS"
BUC_157 / BUC-157 → "CO BAG" | "CO bag"        (separator-only difference)
"Bucket hats" → name "RCLN-111"                 (SKU and name transposed)
```

Of the 25 distinct products on open POs, **6 sit in a duplicated-SKU group.**

### No edit history exists

```
vessl.audit_log                          0 rows (empty)
triggers on vessl.products               (none)
products where updated_at <> created_at  0 of 278
created_at / updated_at range            2026-08-06 .. 2026-08-27
```

`updated_at` defaults to `now()` at insert and nothing advances it —
`CreateProductModal`'s payload omits it and there is no trigger. **This database
cannot date or reconstruct any product edit.** "What was this called before?" has to
be answered from memory or emailed PO PDFs. Consider adding an `updated_at` trigger
as part of the cleanup, so the next session has history.

### Still generating duplicates

`page.jsx:2818` and `page.jsx:5001` ("Save as Products and Quotes") dedupe with
`.eq('name', name).maybeSingle()` — exact, case-sensitive, name-only — then insert
`{name, sku: it.prodId || null}`, writing the picker's product-id slot into the SKU
column. Case-variant names create new rows. **This is an active source of the mess,
not just legacy.** Fixing it is arguably prerequisite to cleaning up behind it.

---

## 5. `UNIQUE (purchase_order_id, product_id)` — the constraint that bites

One PO cannot carry the same product on two lines. Nine of the 13 exactly-one
matches are blocked by it:

```
KUI072726B  Sweatpants, Navy   3 lines   qty 180 / 180 / 80   @ 10.50
KUI072726B  Sweatshirt, Navy   3 lines   qty  75 /  75 / 40   @  8.80
KUI072726C  Tee, White PT      3 lines   qty 450 / 450 / 240  @  7.00
```

Every other field on those lines is identical or NULL. Nothing in the data says
whether they are sizes, delivery splits, or genuine duplicates. **They stay NULL.**
If they turn out to be one line that was split, *merging* them is what makes the
product linkable — not loosening the rule. The constraint is being kept precisely
because the PO does not say what those lines mean.

A backfill written without a same-PO collision guard will abort on the second row
of the first group and set nothing at all, losing the rows that were fine.

---

## 6. Deferred work

- **`scratchpad/14-batch1-poi-product-id.sql` — PARKED, needs Kristy.** Re-censused
  2026-08-31: of 166 unlinked PO lines, 64 have no name match, 89 are ambiguous,
  and 13 resolve to exactly one product under both case-insensitive and exact
  comparison. Nine of those are blocked by `UNIQUE (purchase_order_id, product_id)`
  — three groups of three lines resolving to the same product on the same PO — so
  **four are actionable**.

  **The question for Kristy:** those four resolve to `BGRHJC-Landed` (×3) and
  `BGLHAC-EXW` (×1). `-Landed` and `-EXW` are **costing bases, not product codes**.
  Linking sets `product_id`, which fires `trg_poi_stamp_product_sku`, which stamps
  `product_sku`, which `page.jsx:2518` prints in the SKU field of the factory's PO
  document. Three of the four POs are `in_production` and one is `shipped` — none
  is a draft — so this changes what an already-issued document says on reprint.
  Either fix those two products' SKUs first, or link and then null the four
  snapshots by hand (which does not re-fire the trigger, since `product_id` is not
  in that SET list). The script carries both options in its header.
- **`page.jsx:2518` / `2651` fallback fix** — ✅ done, shipped in `754d2f9`.
- **Carton-spec two-store split.** `products.units_per_carton` / `carton_l/w/h_cm` /
  `carton_weight_kg` are written and read by `CreateProductModal.jsx` only. The CBM
  and carton maths that drive shipments read `quotes.units_per_carton` /
  `carton_l/w/h` instead (`page.jsx:4645`, `5988`; `pricing.jsx:29`; `quotes.jsx:432`).
  Two parallel stores, no sync. If Kristy edits carton dimensions on the Products
  page and nothing changes downstream, this is why.
- **Duplicate-SKU adjudication** — 30 groups, 63 rows. Needs Kristy and Jenn
  deciding which are the same physical product. Prerequisite to any propagation
  feature and to closing the 78 ambiguous PO rows.
- **`product_id` capture on new SO lines** — going forward; the 254 historical rows
  stay NULL.
- **Three quotes need Kristy, not a script.** Script 19 creates a product for every
  quote whose SKU matches none, and links it. Five quotes are deliberately skipped;
  three of them render as a hollow ring on the Products page and are the ones worth
  a decision:
  - `59456fa3` — **Stuffed lion**, Ritz Carlton, **no SKU**. Needs a SKU before it
    can become a product; a SKU-less product row cannot be keyed on later.
  - `8e477b5b` — **Ceramic mug anniver**, JOHNNIE-O, **no SKU**. Same, and the name
    looks truncated.
  - `56a08f12` — **BUC-157**. Quote says `BUC-157 KU2607001` / *"CO Bag - Buc-ee's
    Reusable Non-Woven Bag "* (41 chars, trailing space); product `c8f3d2d2` holds
    the same SKU under the name *"CO bag"* (6 chars). Same SKU, same thing, two
    names — so the composite key misses it and it shows in the rename modal's
    "same SKU, different name" drift group. A merge/naming decision.

  Two more are skipped and render as a disabled em dash rather than a ring, having
  no product name at all to key on: `415ed5cc` (nothing but an id) and `64ffc2d1`
  (**`PEP-130`**, Peppa Pig Theme Park — a real SKU and a real client with no
  product name, which is the one of the two worth chasing).
- **`lib/prodKey.js` consolidation.** *(Done 2026-08-31 — see `lib/products.js`.)* The composite `sku|name` key that identifies a
  product now exists in five places: `prodKey` (`page.jsx:3358`), `productByKey`
  (`page.jsx`, just above `ProductDetailModal`), `productByKey` (`quotes.jsx`, module
  scope), `keyOf` (`components/RenameSkuModal.jsx`), and the backfill predicate in
  `scratchpad/18-quotes-product-id-and-rename-fn.sql`. All five agree today —
  `btrim`, `coalesce` to `''`, name required — and each carries a comment pointing at
  the others, but that is a convention, not a guarantee. The fix is one exported
  helper beside `lib/textFilter.js`, which is the existing precedent for a pure
  function shared by page modules and components. Deliberately **not** done inside
  the rename change: `page.jsx` imports both `quotes.jsx` and the component, so the
  move needs its own pass to avoid an import cycle, and mixing it into a behavioural
  change would make the diff unreviewable. Note `quotes.product_id` now reduces how
  often the key is consulted at all — it is the fallback, not the primary — so this
  is tidiness, not a live defect.
- **Product-change propagation** (Kristy's original ask) — ✅ shipped as the Rename
  SKU action (`d99f63a`) plus create-or-link on quote save (`6b8b3bb`). Not a
  cascade: a checklist, because a SKU means different things in
  `products.sku` (live), `purchase_order_items.product_sku` (a snapshot of an
  issued document) and `sales_order_items.client_sku` (mixed — 229 of 254 hold
  ours, 25 hold the customer's own code). Note `vessl.products` has **no price
  column** at all, so order prices are structurally immune to propagation; prices
  live on the order line and in `quotes.tiers`.
- **Docs-only commits each trigger a full production deploy.** Every push to `main`
  builds and deploys, including commits that touch only `CATALOGUE.md`,
  `PORTAL.md` or `RFQ-SEND.md` — none of which the app imports. On a working day
  that is roughly half the deploys: measured from the Vercel API, **7 production
  deploys on 2026-09-04 and 7 on 2026-09-03**, of which the docs commits were
  `8db3838`, `5692ece` and `d26e860`.

  **No limit has been hit.** Nothing has failed or been throttled — every
  deployment in both days reached READY. This is waste and a ceiling worth knowing
  about before a heavy day meets it mid-feature, not a live incident. Vercel's
  Hobby plan caps deploys per day, so the headroom is real but finite, and the
  number to check against the plan is the daily count above rather than a
  remembered one.

  **DECIDED 2026-09-08 — batching. Docs commits ride the next feature push
  instead of going out alone.** Commit docs when the work is fresh, leave them in
  the tree, and let them travel with the code. A docs commit costs a deploy only
  when it lands with nothing else, which is now the case to avoid rather than the
  norm.

  **Vercel's Ignored Build Step was considered and rejected**, and the reason is
  worth keeping because it is not about the mechanism working. An `ignoreCommand`
  in `vercel.json`, or the project setting, would skip docs-only builds correctly
  enough. What it would break is the **invariant every deploy check in this repo
  rests on: the production deployment's SHA equals `origin/main` HEAD.** Once some
  pushes deliberately do not deploy, production legitimately lags `origin/main`,
  and "verify READY by SHA" can no longer tell a skipped build from a build that
  failed to trigger. That check is the thing that has caught real problems here —
  it is why the dev-port guard bug and the alias-attaches-after-READY lag were both
  seen rather than assumed. Trading it for a handful of deploys a week is the wrong
  side of the bargain. Batching costs nothing and keeps the invariant exact.

  Consequence for the deploy check, unchanged and now deliberate: after any push,
  the built SHA must equal `origin/main`. A mismatch is a fault, never a
  configured skip.

---

## The scripts are the as-run record

`scratchpad/14` through `scratchpad/35` are the scripts as actually executed
against production, not drafts. Each carries its measured baseline in the header,
its guards in the `where` clause rather than in a comment, and a verification
block that returns exactly one row on success.

| | what it did | status |
|---|---|---|
| 15 | BUC-157 rename across products / quote / SO line | run 2026-08-28 |
| 16 | `purchase_order_items.product_sku` + the stamping trigger | run 2026-08-31 |
| 17 | trigger behaviour test — transaction-only, never committed | rehearsal only |
| 18 | `quotes.product_id` + `vessl.rename_product_sku()` | run 2026-08-31 |
| 19 | `products.origin` + 48 products from quotes + links | run 2026-08-31 |
| 20 | BUC-157 draft PO line linked | run 2026-08-31 |
| 22 | client name recase, five clients, 49 rows | run 2026-09-02 |
| 23 | HTS description title-case, 24 rows | run 2026-09-02 |
| 24 | HTS description bracket case, 2 rows | run 2026-09-02 |
| 25 | `htscodes.duty_note` + both column comments rewritten | run 2026-09-02 |
| 26 | the two compound-rate hat codes, 44.50 + the note | run 2026-09-02 |
| 27 | 18 size-less parent products, origin `size-merge-27` | run 2026-09-03 |
| 29 | the two surviving name-variant rows renamed | run 2026-09-03 |
| 28 | 110 size-variant rows retired, `active=false` | run 2026-09-03 |
| 30 | regulation and material links copied to the survivors | run 2026-09-03 |
| 31 | `staff_profiles.notifications_enabled`, NOT NULL DEFAULT true | run 2026-09-03 |
| 32 | `quotes.size_plate_fees` + `quotes.size_cartons`, both jsonb NOT NULL `[]` | run 2026-09-04 |
| 33 | five BUC bag PO lines linked to their products, v4 after three failed rehearsals | run 2026-09-04 |
| 34 | `vessl.kui_settings` + `can_write_settings()` + RLS, v2 after the default-ACL catch | run 2026-09-08 |
| 35 | six `bank_` columns on `kui_settings`, `ach_info` dropped | run 2026-09-08 |
| 14 | four remaining PO-line links | **parked, see §6** |

---

## Client names — where they live, and the 2026-09-02 recase

### Census correction

An earlier pass treated the *candidate* list — `sales_orders`, `purchase_orders`,
`shipment_quotes`, `shipments`, `containers`, `products` — as places a client name
might be stored. Confirmed against `information_schema`: **none of them holds a
name.** They carry `client_company_id` (uuid) and resolve the name through
`companies!client_company_id(name)` at render time.

**Exactly five text columns hold a client name:**

| Column | Rows | Distinct |
|---|---|---|
| `vessl.companies.name` where `type='client'` | 22 | 22 |
| `vessl.quotes.client` | 325 non-blank of 328 | 20 |
| `vessl.client_contacts.client` | 41 | 20 |
| `vessl.clients.name` | 4 | 4 |
| `vessl.programs.client` | 1 | 1 |

Plus the pre-migration copies in `public.quotes` / `public.clients` /
`public.client_contacts`, which nothing reads since `lib/supabaseQuotes.js` was
repointed at `vessl`.

### What groups by the name, and what does not

**The All Clients cards and the client detail page group by `quotes.client`,
trimmed** — `quotes.jsx:885` and `:918` — never by `companies`. So a rename must
move `quotes.client` and `companies.name` together or one client shows as two
cards. Company upserts also key on the name (`onConflict:'name,type'`), so an old
spelling arriving later creates a second company row rather than matching.

**The portal does not group by name at all.** `portal.users` maps a login to a
company by `company_id` (uuid); `portal.orders` and `portal.me` join on
`client_company_id`. `portal.orders` *displays* `companies.name` but never matches
on it, no `client_keys` table exists, and no portal RLS policy references a name.
A rename changes what a client sees, never what they can reach.

### The recase (script 22)

`BUC-EES → Buc-ees` · `JOHNNIE-O → Johnnie-O` · `legal → Legal` ·
`PAW PATROL → Paw Patrol` · `TREMONT SPORTING CO → Tremont Sporting Co`

49 rows across the five columns. Verified after commit: 0 old spellings left,
**21 All Clients cards** (20 distinct `quotes.client` + the `Unassigned` bucket for
3 blank rows), Killian's `company_id` unchanged, and the 16 `public.*` rows left
on the old spellings deliberately.

**Recases only — no merges.** These stayed separate on purpose, and folding any of
them would change the client count, which is a different decision:

- `bucees` (1 row, contacts) is **not** `Buc-ees`.
- `Monster energy ` (1 row, contacts) is **not** `Monster Energy` (1 row,
  companies) — and note the **trailing space** on the first.
- The six Legolands — bare, California, Florida, Japan, New York, Windsor — are
  six real clients. Only five appear in `companies`; `Legoland New York` exists
  only in `vessl.quotes`.

**Whitespace, found while measuring:** exactly six rows across two values carry a
trailing space — `Alison ` and `Monster energy `. Neither was a rename target, and
script 22 pins them so it cannot quietly normalise them. The All Clients grouping
trims, so `Alison ` and `Alison` already collapse into one card. Worth its own
pass; not folded into a recase.

**Numbers drift.** `companies` has since gone 34 → 33 rows and 22 → 21 client
names, because the ZZTEST company was deleted after script 22 ran. Its `d1`/`c1`
checks passed against 34 and 22 at run time. Re-census before reusing any figure
from that file.

**Three checklist rules these scripts earned the hard way.**

*The first branch of the verification `union all` must alias all three columns —
`as chk`, `as got`, `as want`.* `UNION ALL` takes its output column names from the
first branch alone, and the filter references `got`. Omit the alias and the column
is named `?column?`, so the statement dies with `42703` **before any check is
evaluated** — and returns no rows, which is indistinguishable from the "0 rows =
the query did not run" case the sentinel exists to catch. Scripts 14 and 20 both
shipped without it and failed on first run.

*Zero apostrophe characters outside string literals — comments included.*
Strict Postgres ends a `--` comment at the newline and ignores quotes inside it,
but the SQL client these are pasted into lexes quotes first. Script 23 carried
`-- 4203301090  was: men's belt`; that apostrophe opened a string that ran past
the newline, and the parser reported `42601 syntax error at or near "plastic"` —
pointing at a line several rows later that was perfectly fine. It survived one
reprint because the fix doubled the apostrophe in the value and left the comment
alone. Write comment prose without possessives or contractions, double
apostrophes only where the data truly holds one, and verify mechanically before
printing: apostrophes inside comments must be 0, and the total apostrophe count
must equal 2 per literal plus 2 per doubled pair. Test a `values` block by
running it as a read-only `select count(*) from (values …) t(…)` first.

*Printing a script is not writing it.* Several scripts were printed into the chat
and never landed in `scratchpad/`, so the on-disk record and the executed record
diverged — and 14's on-disk copy was a stale pre-re-census version naming
different rows than the one that had been reviewed. Write the file, then print it.

*A check on comment or free text must be simulated against the exact string the
script installs, before the script is printed.* Script 25's first rehearsal
returned two rows: `a5` and `z0`. That check asserted the word `permanent` was
gone from the rewritten `total_duty` comment — but the replacement text quotes
the superseded claim in order to supersede it, so the word is present in both and
the check could never pass. The DDL was correct and every other check passed. The
aliases and the apostrophes had been verified mechanically; this one was asserted
by eye. It became a positive test on `SUPERSEDES` plus a negative one on `0.207`,
a figure only the old text held — the pair proving the comment was replaced
rather than appended to, which one check established in neither direction.

---

## Compound duty rates — 2026-09-02, scripts 25 and 26

Two hat codes had carried no duty since the August import, and the `total_duty`
comment called them permanently NULL: `6505006090` Beanie and `6505009900` Bucket
Hat are **44.5% plus USD 0.20 per kilogram**, and the column holds a percentage.
Kristy supplied the rate and proposed storing the percentage with a note. One
figure covers both codes, confirmed — the earlier `7.5% plus 0.207 per kilo` in
the column comment was superseded, not a typo of it.

**The percentage is stored and the surcharge is not computed.** A per-kilogram fee
needs a shipped weight nothing in a quote holds, and a number invented from an
assumed weight would be worse than an honest gap because it would look like the
others. `computeDuty`, `tierDuty` and `activeFreight` are untouched.

**`duty_note` is a surcharge note, not a comment field.** Anything stored in it
renders as an amber warning that the computed duty is incomplete, so a note that
is not a surcharge would warn about nothing. The column comment says so, and
`CodeModal` refuses a note with no rate — the same invariant script 26 asserts.

**Sequencing was DDL, then code, then data**, and the middle step is the point.
Had 26 run before the reading build shipped, the quote form would have computed a
confident `44.5% of EXW` with nothing saying a per-kg fee sits outside it — worse
than the `No duty on file` it showed before. 25 was safe to run early because
nothing read the column; 26 waited on `ae6a4e0` being READY by SHA.

**Duty never appears alone on a client-facing document** — the printed quote and
the CSV fold it into `activeFreight` (freight + duty). So the surcharge gap flows
into a combined figure and into total cost. The note is internal, and pricing the
surcharge in is a commercial step, not something the app does.

After 26: 112 rows, 2 carrying a note, **1 row still with no rate** — `4202220000`
Swimsuit Bag, a genuine "not established" rather than a compound rate. The
"permanently NULL" concept is gone from the schema. The count of no-rate rows is
deliberately not repeated in `codes.jsx`, where a stale `9` sat for weeks: it
moves whenever anyone fills one in.

---

## SKU size variants merged into parents — 2026-09-03, scripts 27, 29, 28, 30

Kristy commissioned merging size-variant SKUs into size-less parents. **Nothing
was deleted and nothing was repointed**: variants were retired, parents created,
and compliance links copied rather than moved. Every quote and purchase order
line still points exactly where it did — 110 quotes and 30 PO lines on retired
rows, asserted after the fact rather than assumed.

**The classifier is the operation.** A sized row is one whose trailing tokens,
split on `-` `_` space `/`, are size vocabulary, stripped iteratively so
`X-Youth-XL` loses both. Costing bases (`-EXW`, `-Landed`, `-INT`, `-USA`) are
excluded — those are script 14's park, not sizes. Two normalisations matter and
neither is obvious: the LHS and SL skus use a **spaced** hyphen
(`LHS-152 - Large`), so repeated separators must be collapsed and trimmed, or
`SL-117` splits into two groups and LHS-183 never joins its siblings.
19 groups, 105 sized rows, matching the CSV-side census exactly.

**Three findings the brief did not have, each from measuring rather than
reading the export:**

- **Ten of the 110 rows were already `active = true`, not NULL** — the three
  LL1-1616 rows, the five SL-117 rows, the two LL1-380 non-survivors. The brief
  described the step as writing false over NULL, so `and active is null` looked
  right and would have skipped exactly those ten, leaving them selectable while
  every count check still passed. The predicate is `is distinct from false`.
- **`LLF-1605 youth poncho` escapes the trailing-token rule** because the size
  word sits in the middle, not at the end. It was added by uuid.
- **39 of the rows share a duplicated sku string.** Each BG group is 6 sizes x 2
  rows, and within a pair only one row carries the PO line. `sku` does not
  identify a row here; only `id` does. Uniqueness on this table is
  **`(sku, name)`**, not `sku`, which is what makes a bare parent able to coexist
  with its variants at all.

**The 110 uuids were resolved, not transcribed.** Pasting them by hand is 110
chances to retire a product nobody meant to touch; the target set is built by the
same classifier, minus one exclusion, plus six rows named by uuid, and `a1`
refuses to proceed unless it resolves to exactly 110.

**Order was 27 → 29 → 28 → 30**, and the middle swap is deliberate: renaming the
survivors *before* retiring their siblings lets the deactivation script assert
each survivor by its final name, so a mis-picked row fails a guard instead of
being retired quietly.

Left deliberately alone: `LL1-1629-MED` stays selectable (Kristy), the Ollie row
was already false, Olivia survives, the 14 Youth-line products and the costing
bases are out of scope. `products` 328 → 346; `active` true/false/null
91/51/186 → 81/161/104; `product_regulations` 153 → 170; `product_materials`
5 → 7.

**A fifth checklist rule, from a defect reported in review:** the verification
block must be checked to *parse* before printing — branch selects minus one must
equal the `union all` count. It is the first structural check in the set rather
than a lexical one. Script 27 also shipped with a wrong `want` on `a6`: it
asserted the LHS-183 bare row carried no origin, when it reads
`quote-backfill-19` from script 19. The insert was correct and the rehearsal
failed on the check alone — the same fault as script 25's `a5`, and the same
cause: a value asserted by eye instead of measured.

---

## Two findings from the settings rework — 2026-09-03

### `vessl.kui_settings` has never existed

> **RESOLVED 2026-09-08 by script 34**, which created the table. The finding below
> is kept as written because it is the evidence that motivated the script and the
> record of what the form did in the five days it had no table behind it. For the
> table as built, see the script 34 section further down.

The Settings page carried a Company Info form and an ACH / Wire block whose
caption read *"Auto-fills the bottom of client quote sheets."* **It never has.**
Checked across every schema and every relation kind in `pg_class`, not just
`information_schema.tables`: no relation of that name exists anywhere, and
nothing matching `%setting%` does either. `SB` is pinned to `db: { schema:
'vessl' }`, so `SB.from('kui_settings')` resolves to `vessl.kui_settings`.

Three consequences, and the reason it went unnoticed for so long is that all
three are quiet:

- The load returns `{data:null}` and falls back to blank defaults, so the form
  renders **empty rather than broken**.
- The save errors — but only after somebody has typed a page of bank details in.
- `printClientSheet` in `quotes.jsx` is its **only** reader, and it gates the
  payment block on `settings?.ach_info`. That block has therefore **never
  rendered on a client quote sheet**. The sheet falls back to the hardcoded
  string `King Universal Inc.` for the company name.

The form now lives on an admin-only Company tab with a visible notice saying so.
Creating the table is approved and separate; the notice comes out when it lands,
and its RLS shape is to be proposed in that script for approval.

### `staff_profiles` write access is not per-user

`vessl.staff_profiles` carries two policies: `read_own_profile` (SELECT, own row
by `auth_user_id` or JWT email) and `staff_only` (**ALL**, `vessl.is_staff()`).
The second is the one that matters — **any authenticated staff member can UPDATE
any profile row, including somebody else's `role`.**

Nothing in the app offers to do that, and the Settings page writes only the
signed-in person's row, keyed on the id it resolved for their own address. But
the admin-only Company tab added on 2026-09-03 is **UI intent, not enforcement**,
exactly the standing `canCreateProducts` has: the tab is hidden, the API is not
closed. Recorded here so the next person reading that gate knows what it is and
is not. Tightening it is an RLS change, deliberately not made in that pass.

---

## Per-size plate fees and cartons — 2026-09-04, script 32

Loren: *"I have to add in plate fees to each size as they are different"* and
*"the carton dimensions are also different for each size bag."* Two new jsonb
columns on `quotes`, both `NOT NULL DEFAULT '[]'`, mirroring `size_price_deltas`
exactly — same shape, same scope, same strings-in-form-state rule.

**Quote level, not tier level, and that is load-bearing.** `ProductDetailModal`
`.save` writes `tiers` as a **full replacement**, so anything held inside that
json survives only as long as whatever that modal last read. Its own column
survives. Confirmed with Loren that neither varies per quantity break, so tier
level was not needed anyway.

**A plate amortizes over its own size, not the tier** — the one way it differs
from mold, and the point of the feature. Mold spreads thinner as the tier grows;
a plate spreads thinner only as its size grows. A $400 plate over 2,000 units is
$0.20; over 200 it is $2.00, and that jump on a short size is what the buyer
needs to see. The size row's margin is recomputed from tier cost **plus** plate
rather than adjusted from the tier margin, so no rounding gap can open between a
size row and the tier above it.

**Cartons are dimensions only.** `units_per_carton` and `carton_weight` stay
quote-level — only the dimensions vary by bag size, per Loren. Entries are sparse
and may be **partial** (a size can override height alone); anything absent falls
back to the quote-level column *at the point of use*, never at load time, which
would freeze today's value into the row.

**Where each reaches.** Plate fees are internal — the quote editor and nothing
else; mold's existing appearance on the client PDF is unchanged. Cartons compose
into each expanded PO row's `carton_info` as `60×40×30 cm`, printed by
`buildPODoc` through the box line it already had, with **zero template changes**.
A line with no override still gets the quote-level dims: the factory needs a box
size on every line.

**`ApplyBidModal` is deliberately untouched.** It keeps reading the quote-level
carton columns, so on a quote carrying per-size dimensions its CBM is an average
rather than an exact figure. Riley has been told; that is his call to make later,
not ours to make for him.

---

## The BUC bag lines — 2026-09-04, script 33, and the three rehearsals it took

Five `purchase_order_items` rows named BUC-148, BUC-149 and BUC-150 in free text
but carried no `product_id`. The Inventory page groups on client, product name and
sku, and on an unlinked row **the name is the description**, so two typings of one
product drew two lines. Setting `product_id` on the five collapsed the display
from 74 lines to 71.

**No description was touched, and that was the design.** `description` is the
snapshot of what the purchase order said, and all five POs are `in_production`,
meaning issued. Rewriting the text to fix a display would rewrite an issued
document. `buildPODoc` renders `description` first and falls back to the product
name, so no factory document changed. The verification asserts this rather than
claiming it: `a3` counts descriptions identical to the pre-state snapshot.

A sixth row appears alongside the five in any `ilike` net over these SKUs — the
BUC-150 twin on another PO, already linked to `acbca34f` before this script and
deliberately not touched. Linking the fifth row is what merged that pair.

### Three failed rehearsals, three different characters eaten in transport

`a0`, the identity guard, returned 0 of 5 three times while every component
returned 5 when run standalone against the live database. The data never moved and
the file on disk was byte-correct every time.

| | what `a0` matched on | outcome |
|---|---|---|
| v1 | descriptions carrying runs of five spaces | 0 of 5, plus `c3` asserting a want measured by eye |
| v2 | id + raw `length()` + text normalised with a backslash-s pattern | 0 of 5 |
| v3 | id + raw `length()` + text normalised with `[[:space:]]` | 0 of 5, identical |
| v4 | **id + raw `length()`, no text at all** | passed |

The scripts are copied by hand into a SQL editor, and **that transport is lossy in
a different way each time**. v1 lost its runs of spaces to reflow. v2 lost a
backslash, collapsing the pattern to s-plus, which replaces runs of the letter s.
v3 most likely lost a colon: `[[:space:]]` contains `:space:`, clients rewrite a
single leading colon as a bind placeholder, and the exception they make is the
**double** colon cast — which is why every `::uuid` in the same file survived and
only that one check broke. Unproven, and v4 does not depend on it.

The pattern worth seeing is that **each fix was itself free text carrying a new
fragile character.** Three escapes, three failures. The answer was not a fourth.

### What finally diagnosed it

Every theory came from running `a0`'s pieces standalone, and standalone runs
exercise neither the transport nor the surrounding transaction. What settled it was
a diagnostic that **reproduced the guard in the position it runs** — snapshot
built, `a0`'s four components counted into a temp table before the update, the
update run, everything reported either side, ending in `rollback` so it wrote
nothing and was safe to hand over. It reported, before the update:

```
b33_rows 5   joined 5   pid_null 5   len_ok 5   norm_ok 0   a0_all 0
```

Which exonerated the snapshot, proved the update, and named the one failing
condition. `len_ok` had held at 5 in every run including the failures — that is
the evidence that raw character count is the identity test that survives this
path.

### Rules earned or corrected

- **Corrected — the fifth rule's own advice was the bug.** It had said to assert
  identity with `length()` *plus normalised text whose literals are single-spaced*.
  That normalisation expression is free text too, and it is what wrote v2 and v3.
  Identity is now **`id` plus `length()`, nothing else**. Comments may quote the
  text freely; nothing matches on them.
- **Extended** — the list of characters a hand paste eats now reads runs of
  spaces, backslashes, and single colons including inside a POSIX class.
- **New, the sixth rule — test a guard in the position it runs, not just against
  the data it reads.** When a check fails and re-running its pieces says it should
  pass, stop theorising and write the rollback-terminated diagnostic. One round
  trip, and it names the condition instead of guessing.
- **Reinforced, the third rule** — every `want` measured, never asserted. v1's
  `c3` claimed 4 for a number that was 17 and had never been measured, the same
  fault script 25's `a5` had. `c3` is now a before-and-after difference, which is
  the claim actually being made: this script does not go near the `-EXW` and
  `-Landed` costing rows, so the count must come out unchanged either side.
- **A self-check blind to its own fault class is worse than none.** The lexer that
  cleared v3 skipped newlines *before* testing whether it was inside a string, so
  it could never have detected an embedded newline — and it reported a pass. It
  now reconstructs literals and checks backslashes, newlines, multi-space runs,
  single colons, comment apostrophes, branch count against `union all` count, the
  three first-branch aliases, and that the file ends in `rollback`.

---

## Inventory status column — and the mixed-group case that cannot happen yet

The breakdown tables carry the product's catalogue status between SKU and On
order, with a filter beside All Clients and All Factories. `products.active` was
one more column on a join the query already made, so it costs no extra request.
The visual vocabulary is the Products page's exactly — filled 8px dot in
`var(--ok)` / `var(--hot)` / `var(--muted)` for true / false / undecided, hollow
1.5px ring for no product record — because two controls in one app that spell the
same four states differently is a bug nobody reports.

**The filter narrows contributing lines**, like the factory filter. Tab 1 reads
the whole line set and does not move.

### The finding: status is per-product, the display key is not

Rows group on `(client, product name, sku)` — **not on product id** — so in
principle one row can hold lines belonging to two different catalogue entries,
and those two entries can disagree about `active`. That would make a status
filter partially drop a row's quantity, which is the behaviour the factory filter
has and the status filter is not supposed to have.

**Measured against the live set: it does not happen.** 158 lines, 71 display
groups (the same 71 script 33 produced), **zero groups holding more than one
status**, including the case likeliest to break it — a description-fallback row
colliding with a real product name under a blank sku. Bucket split: `noprod` 108,
`active` 34, `inactive` 12, `notset` 4.

**That is a fact about today's data, not a structural guarantee.** Two catalogue
rows sharing a name and a sku would collide, and nothing prevents that. So the
row renders **Mixed** with a hollow ring and an explaining tooltip rather than
reporting whichever line landed first.

**The tripwire is judged against the whole line set, not `shown`.** Reading it
from the filtered rows would make a mixed row look unanimous precisely when the
status filter was dropping half of it — the failure would hide itself at the
moment it started to matter. This is the same shape as the factory caveat that
only appears while a factory is selected: say the thing that is true, at the time
it is true.

If a Mixed row ever appears, the fix is upstream — two catalogue entries sharing
a name and sku is a duplicate to merge, in the same family as the size-variant
merge (scripts 27 to 30). It is not a display rule to tune.

---

## `kui_settings` — 2026-09-08, script 34, and the privilege that was never granted

`vessl.kui_settings` now exists: one row, `id = 1`, holding the company details and
the ACH/wire text that print on a client quote sheet. Created 2026-09-08, rehearsed
to `z0`, committed, verified outside the transaction in a fresh tab including the
behaviour test.

**The code was already written.** `CompanySettings` in `page.jsx` already loaded
`id = 1` and already upserted `id = 1`; `printClientSheet` in `quotes.jsx` already
read the row and already gated the payment block on `ach_info`. Both were built
against a table that did not exist, which is what the "Not connected yet" notice
was for. So the column list was **not a design choice** — it is exactly the payload
that upsert already sends, and the only code change on landing was deleting the
notice.

### Shape

- `id integer primary key default 1` **plus** `check (id = 1)`. The default alone
  would not stop a second row and the primary key alone would not stop `id = 2`; it
  takes both plus the check to make the table structurally single-row.
- Nine columns, all of them the form's payload: `id`, `company_name`,
  `contact_name`, `email`, `phone`, `office_phone`, `address`, `ach_info`,
  `updated_at`.
- **Not seeded.** The first Save inserts, which is also what exercises the INSERT
  policy in real use.
- RLS: **read for every authenticated user** — printing a client sheet requires it,
  and printing is not restricted to the roles that may edit — **insert and update
  for `admin` and `staff` only**, matching the Settings tab allowlist, and **no
  DELETE policy at all**.
- `vessl.can_write_settings()`, new, mirrors `vessl.is_staff()` and adds the role
  filter. `is_staff()` could not be reused: it returns true for *any*
  `staff_profiles` row, `limited_qc` included. The mirrored part that matters is the
  `OR` on email — **one of the seven profiles has a null `auth_user_id`**, so a
  check written against `auth.uid()` alone would lock that person out.

### Who the allowlist covers — settled 2026-09-08, do not re-investigate

Six accounts hold `admin` or `staff`, all `@kinguniversal.com`: **riley** (admin,
the only one), and **carmela**, **kristy**, **loren**, **mattdillon** and **steven**
as staff. One `limited_qc` account is excluded by design.

**Carmela is the one to know about, and she is fine.** Her profile is the only one
of the six with a **null `auth_user_id`** — a real colleague with a legitimate
profile whose login has simply never been linked. Confirmed 2026-09-08; she gets
the same access as the rest of staff and **no allowlist or role change was made.**
She is also the live reason `can_write_settings()` matches on email as well as
`auth.uid()`: a check written against `auth.uid()` alone would silently exclude
her. If a future change to that function drops the email branch, it locks her out
and the failure will look like a permissions bug rather than a missing join.

### The finding: a privilege you did not grant is not a privilege they lack

**Rehearsal 1 failed on `c1`, reading `true/true/true/TRUE`.** `authenticated` held
DELETE on a table the script never granted DELETE on.

The cause is a schema-level default. `pg_default_acl` carries, for schema `vessl`,
object type table, **`authenticated=arwdDxtm/postgres`** — an `ALTER DEFAULT
PRIVILEGES` that grants all seven privileges on every new table **at CREATE time**.
So the `grant select, insert, update` added nothing, and withholding DELETE
withheld nothing.

v2 revokes first and grants back:

```sql
revoke all on vessl.kui_settings from authenticated;
grant select, insert, update on vessl.kui_settings to authenticated;
```

**This is why every other `vessl` table shows `authenticated=arwdDxtm` and leans
entirely on RLS** — not a decision anyone made, just the schema default nobody has
revoked. `kui_settings` is the first table that does not. Whether the rest should
be tightened is a separate question and is not something to fix table-by-table on
the way past.

**The lesson generalises past privileges.** The same trap runs the other way at the
policy layer: a permissive policy elsewhere ORs with yours, so `products` and
`quotes` each carry a `..._auth_all` policy with `qual: true` that makes their
`staff_only` policy irrelevant. **Assert the end state from the catalogue rather
than reasoning forward from the statements you wrote.** `c1` caught this only
because it asked `has_table_privilege` what was true, instead of concluding "we
did not grant DELETE, therefore there is no DELETE."

Two checks were added rather than the want being softened to fit. `a2` captures, in
the pre-state block, that the schema default exists — if it ever reads 0 the revoke
has stopped being load-bearing and can be reconsidered instead of copied forward.
`c3` asserts TRUNCATE, REFERENCES and TRIGGER went too; on `staff_profiles` those
same three currently read `true/true/true`, so it is not a tautology.

### The check constraint is asserted from the catalogue, not by tripping it

Proving `id = 2` is refused means causing an error, and a failed statement poisons
the transaction unless wrapped in savepoint handling that differs by client. So the
rehearsal asserts the constraint **exists**, and the behaviour test lives in
`34-after-commit-checks.sql`, run in a fresh tab after commit, where a rejected
insert costs nothing. It failed with `kui_settings_single_row` as intended, and the
table still reads 0 rows afterwards.

That second file exists because its lines carry quotes, and **a quote inside a `--`
comment is what broke script 23** in this client.

---

## Company Banking — 2026-09-08, script 35 and the redirect

### What changed, and why the plan changed mid-build

The Company form was originally a **tab inside Settings**, widened earlier the same
day from admin-only to admin plus staff. That was built and reviewed before the
shape was reconsidered: company details and bank details belong to the **business**,
while Settings holds what belongs to the **person** — your name, your password, your
notification preference — which is exactly why Settings sits in `UNIVERSAL_PAGES`
and every role reaches it. A role-gated business page arriving by way of a
per-person page was the wrong home for it.

So the form moved out to a **top-level sidebar entry, Company Banking, directly
under Codes**, and Settings went back to two tabs. `SettingsPage` now carries no
role check at all. The earlier widening was not wasted — the allowlist it
introduced is the same one now gating the new page, relocated rather than rewritten.

### Script 35 — as-run

Six columns in, one out. `ach_info`, a single textarea printed verbatim, became
`bank_name`, `bank_beneficiary`, `bank_account_number`, `bank_routing_aba`,
`bank_swift` and `bank_address` so the sheet can print labelled lines and **skip
the blanks** — a wire route with no ACH routing number now prints five lines
instead of a paragraph with a dangling empty label.

**Run 2026-09-08. Rehearsal one `z0` row, commit one `z0` row, and
`35-after-commit-checks.sql` clean in a fresh tab — every check passed.** Verified
independently afterwards: 14 columns, the six `bank_` present and `text`,
`ach_info` gone, policies `INSERT, SELECT, UPDATE`, privileges
`true/true/true/false`, `can_write_settings` still `true/s`, 0 rows.

`ach_info` was **dropped rather than kept**: the table was created hours earlier by
script 34 and had never held a row, so there was nothing to migrate and keeping it
would have left a second home for payment details. `a1` guarded that drop by
asserting the table was still empty at run time, so a save landing between writing
and running would have failed the script rather than destroyed data.

All six carry a `bank_` prefix because the table already has an `address` column
holding the **company** address, and the new one is the **bank** address. Unprefixed
they would have been `address` and `bank_address` — a pair nobody keeps straight in
a form or a print template.

**RLS was deliberately untouched and the script says so**, because "no change" is
indistinguishable from "forgotten" a month later. Script 34's policies already
expressed the new intent exactly. Adding a column cannot alter a table-wide policy,
but `c1` through `c4` re-read the policies, the DELETE absence, the grant and the
function from the catalogue anyway — the same end-state-not-inference habit that
caught the default-ACL problem in script 34.

### The three gates, and why one is not enough

`limited_qc` must never reach this page, and neither should a role nobody has
invented yet. The trap is that **`allowedPagesFor` returns `null` — meaning
unrestricted — for every role except `limited_qc`**, so an unrecognised role string
on a real profile row reads as unrestricted and sees every link. A denylist would
have shown it the bank account number.

`COMPANY_TAB_ROLES = ['admin', 'staff']` therefore gates **three** sites:

1. **The sidebar link** — hides it. A hidden link is not a lock.
2. **The `rawPage` → `page` fallback** — a separate line from the `allowedPages`
   one, because that line only constrains `limited_qc` and would happily let
   `#company-banking` through for everyone else. Anyone who cannot see the page is
   sent to `programs` rather than left on a blank screen.
3. **The render** — belt and braces over gate 2, one boolean, and the gate that
   actually keeps the component off the screen if gate 2 is ever edited.

`limited_qc` is covered twice over: its `ROLE_PAGES` list has no banking entry, so
the hash lands it on `testing` before gate 2 is even consulted.

Still **UI intent, not enforcement** — the enforcement is script 34's RLS on the
table itself, which is why that came first.

---

## The `x.s` bug — sized PO lines wrote nothing, 21 Aug to 4 Sep

`5c0ad12` (2026-08-21 13:21) replaced the producer in **both** order expansions
with a `{e, q}` shape and updated only the **sales order** consumer — to
`x.e.label`, `x.e.key`, `skuToken(x.e)`. The purchase-order consumer is not in
that diff at all: it was left reading `x.s`, off objects that carry no `s`.

So every sized PO line wrote `size = undefined`, and `sizePriceOf(it, undefined)`
missed the per-size price map and fell back to the line's flat price. **Nothing
surfaced, because both columns simply read empty.**

**Zero purchase orders affected, measured rather than assumed.** The insert
computes `description` once per line item and copies it onto every size row, so a
sized PO always produces N rows sharing one description on one PO. That is the
fingerprint. Across all 14 POs and 42 line rows created since the refactor: 0 rows
carry a size, 0 groups share a PO and description, 0 rows have a null description
that could have hidden such a group — every PO has as many distinct descriptions
as it has rows. The date boundary does not change it: the eleven POs dated 21 Aug
straddle the 13:21 commit, and had any run the old code while sized it would carry
sizes, which none do.

The feature was therefore **inert, not wrong** — nobody attempted a sized PO in
those two weeks, no factory received a document with a collapsed size breakdown,
and there is no data to repair. The nine sized rows in the table are from one PO
on 31 July, before the refactor, and are correct.

`e.label` and `e.key` are deliberately different strings — the qualified label
prints on the factory document, the key is what the price map is stored under —
which is precisely how one `undefined` could stand in for both without either
looking obviously wrong.

---

## `storedQtyToMap` — the third helper consolidation

`qtyMapFrom` was private to `quotes.jsx`. Both order modals now need the same
conversion to prefill their size grids from a quote tier, so it moved to
`SizeGrid.jsx` beside `sizeKey`, `sizesForSelection` and `toScaleList`, and is
imported back into `quotes.jsx` under its original name so no call site changed.

**It moved rather than being copied because a hand-copy is how `page.jsx` ended up
with a margin that omitted duty** (see the `lib/tierCost.js` consolidation the day
before). That file still carries one hand-written mirror — `deltaMap` inside
`CreateSOModal`, with a comment saying it must not drift from `deltasToMap`. It is
the last of them and worth folding in next time that area is opened.

**The maps do not line up, which is the thing to check before assuming they do.**
`tier.sizeQty` is *stored* as `{scale, size, qty}` records, or as a legacy object
keyed by bare size; the grid keys on `sizeKey(scale, size)`. Reading the stored
value straight into the grid keys it on `"0"`, `"1"`, `"2"` and prefills nothing
while looking like it worked. The converter also keeps its refusal to guess: a
legacy bare-size map is only interpretable when the quote carries **one** scale.

---

## Number drift — 2026-08-28, read this before repairing anything

Over one evening the size of "the problem" was stated as **30 rows**, then **194
orphans / 20 SKUs**, then **13 rows**, and settled at **4**. Only the last is right.

What each was:

- **30 rows referencing a renamed SKU `BUC-800126050103ss`** — no such column, no
  such string anywhere in 12 searched columns, no such product. Unverifiable.
- **194 orphans / 20 SKUs / "no `product_id` FK on `purchase_order_items`"** — the FK
  exists; orphans measured 0 three times. The two halves are mutually exclusive:
  orphans are only possible if the FK is absent, and its presence is what makes them
  unreachable.
- **13 rows** — a real query, correctly measuring exactly-one-match. Wrong as a
  repair set: 9 of the 13 violate `UNIQUE (purchase_order_id, product_id)` and the
  script would have aborted on row 2. Caught only by reading
  `scratchpad/backfill-poi-product-id.sql`, where the same three groups were
  already documented.
- **4 rows** — measured, collision-checked against both the target set and existing
  linked rows (0 collisions), and written up as script 14.

**Rules for the session:**

1. **Census against the live table immediately before any repair.** The table grew
   196 → 253 rows between the earlier backfill and tonight; any figure older than
   the current session is stale by construction.
2. **Check the UNIQUE constraints before writing an UPDATE**, not after it fails.
3. **Read the prior scripts in `scratchpad/`** — two failure modes are already
   recorded there.
4. **A verification that passes on zero rows proves nothing.** Assert the expected
   row count explicitly (`got` / `want`), so a no-op cannot read as a success.
5. **Confirm the column exists before building on it.** A `42703` is the schema
   telling you the premise is wrong.
