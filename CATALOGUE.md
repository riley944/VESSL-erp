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

  **Leaning 2026-09-08, going to Kristy as a recommendation, NOT a decision:**
  keep costing bases as **separate products**, because they carry different client
  prices and different margins. That is a recommendation only — it goes to her
  with the other product questions, because it decides how test reports and
  compliance links attach, and that is her call rather than an engineering one.

  **Do not act on script 14 or on the BG09RL rows until she has answered.** The
  four visible BG09RL rows stay exactly as they are — `-EXW` and `-Landed`
  selectable, `-USA` and `-INT` retired by hand, an asymmetry that is deliberate
  (script 28 explicitly excluded all four suffixes as "script 14's park, not
  sizes"). Script 38 retires only the unreferenced fifth row, `54dff5d7`, which is
  a duplicate of `-EXW` carrying nothing at all — not part of this question.

  **One measurement that shapes the recommendation.** Across all 84 costing-basis
  products (41 selectable): **32 regulation links, and zero test reports, zero
  material links, zero compliance tasks.** So the compliance concern is almost
  entirely *forward-looking* — there is very little attached today that a merge
  would have to move or a split would have to duplicate. The 83 quotes and 26 PO
  lines pointing at them are the weight, not the compliance records.
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
- **A product with no quote is invisible on the Products page, and stays
  selectable.** Found 2026-09-08 trying to retire the `BG09RL-EXW` orphan
  `54dff5d7` by hand and discovering there was nothing to click.

  **The page renders from QUOTES, not from products.** It loads `quotes` and maps
  each row to a product through `matchOf`, so a product no quote points at has no
  row, no status dot and no Active dropdown. Searching its SKU shows only the
  siblings that do have quotes. It is not hidden by a filter — there is no row to
  filter.

  **Measured, and it is not one row: 27 products have no quote at all, and 23 of
  those are selectable.** One of the 23 sits on a purchase order. All 23 remain
  eligible for SKU matching and for `create-or-link` on quote save, so they can be
  matched against, but never seen or managed.

  That combination is the actual hazard: **a product can be picked up by matching
  logic while being unreachable by a person.** The BG09RL orphan was found only
  because a duplicate-SKU census went looking; nothing surfaces the other 22.

  **Not fixed, and deliberately so.** Script 38 retires that one row because it
  was already decided; retiring the other 22 would be deciding something nobody
  has decided — some are probably legitimate catalogue entries awaiting their
  first quote. The fix worth considering is a **"show unquoted products" toggle**
  on the Products page, rendering products with no quote as rows with an em dash
  where the quote columns go. Not built, not scheduled.

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

- **Backups — Riley's call, and there is now a loss to point at.** Raised
  2026-09-10. **No such item existed in these notes before today**; it is opened
  here because the RFQ cascade below is the first confirmed data loss with nothing
  to restore from.

  What is known: there is no audit or history table in `vessl`, and no
  application-level soft delete outside what was just built for RFQs. Whether
  Supabase PITR is enabled on this project, at what retention, and who can trigger
  a restore, is **not something these notes can answer** — it is a dashboard
  setting on Riley's account. That question is the item.

  Until it is answered, the working assumption has to be that **a `DELETE` is
  final**, which is the assumption the RFQ archive change was built on.

- **`order_costs` cannot say whether a cost is billed to the client.** Raised
  2026-09-10 building the order confirmation's totals block, which was specified to
  carry "any additional cost lines the SO carries".

  The table is `id, sales_order_id, kind, amount, currency, note, created_at` — no
  billable flag. Every consumer treats these as **KUI's own cost**: `soMetrics`
  adds them to `cost`, and the Cost & Margin Summary renders each with a `−`
  prefix, subtracting from revenue. Today it holds 5 rows, all `kind = 'freight'`,
  $6,760 to $10,000.

  So printing them on the client's confirmation would show the client what KUI
  pays to move the goods **and** state an order total up to $10,000 above what the
  client owes. `buildSODoc` renders them behind `SHOW_ORDER_COSTS`, **off**, with
  the measured proof in its header: the same fixture totals $3,252.80 off and
  $10,012.80 on.

  **Decided 2026-09-10: it stays off** — these are KUI's costs, not the client's.
  The future item is the flag itself: a per-cost boolean (`billable_to_client`, or
  a `kind` that means "pass-through") so a freight charge genuinely rebilled can
  appear on the confirmation while an absorbed one cannot. Until that column
  exists, the constant is the honest answer — one switch for all rows, defaulting
  to the safe one. **Do not flip it as a shortcut**; a wrong total on a client
  document is worse than a missing line.

---

## Six RFQs and their bids cascaded away — 2026-09-10, script 43

**Confirmed data loss, unrecoverable.** Found while investigating Kristy's ask to
keep losing bids instead of deleting them.

### The count

The 2026-09-08 census recorded **12 sent RFQs, 11 with no bid**. Measured
2026-09-10: **6 rows**, every one `sent`, and `forwarder_bids` holds **6 rows**,
one per surviving RFQ. Six RFQs went in between.

`forwarder_bids_shipment_quote_id_fkey` is **`ON DELETE CASCADE`**, so each delete
took that RFQ's bids with it. The confirm said only *"This cannot be undone"* — it
never named a bid count, so there was nothing on screen to suggest a delete was
also destroying quoted prices. There is no audit table. Nothing can say what those
bids were.

Kristy also **entered four bids on 9 September, 18:42–19:07**, so recording and
deleting were happening in the same sitting. This is not carelessness; it is a UI
that offered one button for "tidy this away" and made it the destructive one.

### What was wrong underneath it

**"Awarded" was never a status.** `page.jsx` derived it from
`forwarder_bids.selected`:

```js
const awarded = quotes.filter(q => !!winnerOf(q.id));   // winnerOf = the selected bid
```

So *"we picked this forwarder's bid"* and *"this forwarder won the shipment"* were
the same bit. With no way to record an outcome on the RFQ itself, deleting the
losers was the **only** way to make the list read correctly — the interface was
asking for it. Script 43 makes `status` the truth; `selected` stays the bid-level
fact, and both are written together in `awardRfq`.

**Nothing said which RFQs were one shipment.** No `shipment_id`; `po_id` NULL on
all six. The three Dallas rows are provably one shipment — same client, same
route text, 20GP, 500 cartons, 10.85 CBM, created inside 2m26s — but only by
inference.

**And inference would have been wrong.** `FQ-UZCK0` carries origin `Shenyang`
while `FQ-D1RQV` carries `Shenyang, China`, and **those two are different
shipments**. A rule keyed on route text would have joined them, or missed a real
trio the day somebody typed a comma. Hence a real `rfq_group_id` column, written
when an RFQ is duplicated — which is already how one shipment gets quoted three
times — and NULL meaning *not grouped* rather than a guess. `markWinner` on an
ungrouped RFQ says so and changes nothing else.

### What now stops it

Delete survives only for a draft that was **never sent and holds no bids**;
`deleteQuote` re-checks both before firing. Everything else archives. **The
cascade is still on the FK** — this is a UI that no longer reaches it, not a
schema fix, and a future caller could still walk into it.

The digest needed no change: `rfq_digest_rows()` already filters `status = 'sent'`
**and** `not exists (bid)`, so resolved RFQs drop out on status alone. It returns
**0 rows today** against 11 last week, because all six now carry a bid.

### The badge that survived the sweep — same day

Four awarded RFQs shipped wearing a **DRAFT** badge. The pill carried the old
rule written as a binary rather than with a `!==`:

```js
q.status==='sent' ? 'Sent' : 'Draft'
```

A grep for `status !== 'sent'` finds nothing here. **The bug class is "everything
else falls into the last branch", and it has two spellings** — only one of which
a `!==` sweep catches.

It is a keyed map now (`RFQ_PILL`), so a status added later renders as itself, and
anything unrecognised falls through to its raw value in grey — visible and wrong
rather than invisible and wrong.

**The same ordering bug sat in the bids band**, and was worse. It tested `bc>0`
before status, so a not-selected RFQ holding a bid — which is every one of them,
that being the point of keeping them — read *"1 bid in — compare & select"*,
inviting a decision already made. The branches written for resolved RFQs were
unreachable on exactly the rows they were for. Status is tested first now, with
the bid count still shown beside it.

Both were found by looking at the rendered card, not by grep. Neither would have
failed a build.

See the §6 board for the backups question this opened.

---

## The order confirmation, rebuilt — 2026-09-10

`buildSODoc` replaced end to end. Reviewed on localhost across four rounds; what
follows is what the rounds decided, not the first draft.

### Chrome will not give you `Page N of M`

`@page { size: letter; margin: 0 }` is what removes Chrome's own header and footer
— the `about:blank` URL, the date stamp. Once it is zero, the page margin has to be
ours: each `.sheet` is a literal 816×1056px (8.5×11in at 96dpi) with 48px padding.

**Then the footer becomes the hard part.** `@page` margin boxes with
`counter(page)` are not implemented in Chrome, and a `position:fixed` footer
repeats on every sheet but cannot know its own number. So **the document
paginates itself in JavaScript**: blocks are measured into fixed-height sheets,
the items table splits row by row with its `thead` re-cloned onto each
continuation sheet, and footers are stamped only once the sheet count is known. It
waits on `document.fonts.ready` first — Inter arriving late would move every break
it had just measured. The parent's print delay went 500ms → 900ms to match.

### A relative image src cannot work in an `about:blank` window

The logo is fetched and inlined as a **data URI**. `/logo.png` resolves against
`about:blank`, not against the app origin, so it fetches nothing.

**This was a live bug in the quote sheets**, found while fixing the order
confirmation: `printQuote` and `printClientSheet` both wrote `<img src="/logo.png">`
into their popups, so every printed quote sheet has been missing its logo. Both now
take a data URI from a shared cached `kuLogoDataUri()`, and drop the `<img>`
entirely when it cannot be loaded rather than printing a broken-image glyph on a
client document.

Two traps worth keeping:

- **Not `LOGO_WHITE`** (`page.jsx:105`, what the sidebar uses). That is the white
  colourway for a dark sidebar and prints invisibly on paper. `public/logo.png` is
  the same crown-globe mark in black.
- **`window.open` must precede the `await`.** Making `printQuote` async put the
  fetch before its `window.open`, which hands the stack back and loses the user
  gesture — popup blockers then kill the print window. Caught before commit; the
  window is now opened on the first line, as `generate()` and `genSO` already did.

### What the document does not say

- **`order_costs` is not printed.** See the §6 board entry — internal cost, and the
  measured proof that printing it would overstate the client's total by $6,760.
- **A terms paragraph and an acceptance/signature line were built and then cut** on
  review. Not commented out: a dead block invites someone to re-enable copy nobody
  has approved. Both are in git history.
- **Currency has no grid cell** — it reads on the order total line, and the cell it
  would have taken went to **Cancel date**, the one field there with a deadline.
- **No website line.** `kui_settings` has no such column; the slot is commented
  rather than faked.
- **`sales_orders` has no `created_by`**, so "Your contact" is
  `kui_settings.contact_name`, and Bill to carries the *client company's* primary
  contact because a sales order stores no contact of its own.

### Line grouping merges sizes, but only at one price

Rows collapse when description, SKU **and unit price** all match, and the sizes
become `S 400 · M 600 · L 300`. Unit price is in the key deliberately — two sizes
at different prices are two commercial lines, and merging them would print one
price for quantities not sold at it.

### Escaping

The old document interpolated client name, ship-to, notes and line descriptions
raw. A client named with an ampersand printed `&amp;`, and anything
angle-bracketed could break the page. Everything goes through `esc` now.

---

## The scripts are the as-run record

`scratchpad/14` through `scratchpad/41` are the scripts as actually executed
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
| 21 | `rfq_digest_rows()` + the only two grants `service_role` holds | run 2026-09-08 |
| 37 | four imported-twice product pairs retired, renamed and repointed | run 2026-09-08 |
| 38 | the unreachable `BG09RL-EXW` orphan retired | run 2026-09-08 |
| 36 | `payment_accounts` + `quotes.payment_account_id` | **written, NOT RUN** |
| 41 | both order-item `UNIQUE (order_id, product_id)` constraints dropped | run 2026-09-09 |
| 39 | 231 sales order lines linked to products, in three passes | run 2026-09-09 |
| 40 | the JON-106 test report moved to the product it describes | run 2026-09-09 |
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

## The RFQ digest — 2026-09-08, script 21, and a key that opens one door

Verified that day: **11 of 12 sent RFQs had no bid recorded, the oldest 47 days.**
A weekly digest now mails that list to Kristy on Mondays.

**The digest cannot run as its caller, so the key had to be narrowed instead.**
`/api/rfq/send` refuses the service-role key outright and says why — it runs every
read under the caller's token, so it can never see a row that person could not
open. A cron invocation has no session. `service_role` carries **`rolbypassrls`**,
verified in `pg_roles`, so **RLS does not constrain it at all and grants are the
only limit**.

So script 21 created **one `SECURITY DEFINER` function**, `vessl.rfq_digest_rows()`,
and granted `service_role` exactly **schema `USAGE` and `EXECUTE` on that
function** — no table grants. Asserted after the fact: it reads none of
`shipment_quotes`, `forwarder_bids` or `companies`. A leaked key returns one list
of RFQ numbers instead of three tables in full.

### `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC`, and `anon` is in `PUBLIC`

This is the function-shaped version of the lesson script 34 paid for on tables.
Two defaults apply to a new function in this schema — the built-in grant to
`PUBLIC`, and an `ALTER DEFAULT PRIVILEGES` giving `authenticated` `EXECUTE`
(`authenticated=X/postgres` in `pg_default_acl`). **The anon key ships in the
browser bundle**, so a function created the obvious way would have published this
list to anyone who found the endpoint.

**The trap is live, not theoretical:** `anon` currently holds `EXECUTE` on the
existing `vessl.is_staff()`. Low impact there — it returns false for `anon` — but
it is the same mechanism, already in effect on a function nobody revoked.

Script 21 revokes from `PUBLIC` and from `authenticated` before granting, and
`b5`/`b6` assert the end state rather than trusting the revokes. The after-commit
file went further and proved the refusal behaviourally: `set local role anon` then
calling the function **must** fail with permission denied. It did.

### The wording is what the data can support

Bids are entered **by hand** when replies are imported, so an absent
`forwarder_bids` row means no bid has been **recorded** — it cannot distinguish a
forwarder who never answered from one whose reply has not been typed in. The
subject and heading say *no bid recorded in VESSL*, and a line under the count
says a reply may exist that has not been entered. Never *no response received*.

Four buckets, worst first: **stale** at 22 days or more needs a decision rather
than a chase, **chase** at 8 to 21, **awaiting** at 2 to 7, and a separate
**unassigned** section for RFQs with no forwarder company recorded — which cannot
be chased at all and need one assigning. `FQ-TO4KF` is that case. Empty buckets
are omitted, and **nothing outstanding sends no email at all**, because a weekly
note saying there is nothing to report is how a weekly note stops being read.

Weekly rather than daily: 12 RFQs across seven weeks gives a daily mail almost
nothing new to say, and the first send would have repeated nine items already
ignored for 11 days or more.

**The service key is currently the LEGACY `service_role` JWT.** If legacy keys are
disabled the route stops at its configuration check, so the symptom is a missing
digest and a *not configured* message rather than a read failure. The fix is
swapping that variable's **value** for the new `sb_secret` key — no code change and
no new script, because the grant is to the **role**.

---

## Duplicate products resolved — 2026-09-08, scripts 37 and 38

A census of selectable products (`active is distinct from false`) found **seven
duplicate-SKU groups**. Four were the same product imported twice; three were not
cleanups at all.

**Script 37 took the four.** Each pair had one row carrying the purchase order line
*and* a quote, and one carrying only a quote. For each: the quote-only row was
retired, the survivor renamed from its padded spreadsheet line to a clean name, and
the orphan quote repointed onto the survivor. Run 2026-09-08, rehearsal `z0`,
commit `z0`, after-commit checks clean.

Names dropped the SKU prefix, since the SKU has its own column — `LL1-1212␣␣␣␣␣Cotton
Christmas Bag␣␣␣␣␣Red Reindeer` (50 chars) became `Cotton Christmas Bag Red
Reindeer` (33). The `Christmsas` typo went with it. **`b2` asserted the resulting
LENGTH, not the text** — a `SET` value has to be a literal, and a paste that lost a
character would otherwise store a wrong name silently.

**The repoint was deliberate, and the app refuses to do it implicitly.**
`linkQuoteToProduct` updates `quotes.product_id` only where it `IS NULL`, because
that write fires from an Active toggle and a toggle is not a statement about which
product a quote belongs to. That guard is right for an implicit write. But
`matchOf` reads `product_id` **first** and only then falls back to sku and name, so
leaving four quotes pointed at rows the script had just retired would have rendered
each with a red **Inactive** dot describing a decision nobody made about it. Moving
the link is what makes the retirement honest. Nothing client-facing changed —
`printClientSheet` prints `q.product`/`q.sku` from the quote row, and PO lines print
`product_sku` stamped from their own `product_id`.

**Script 38 took a fifth row the interface could not reach** — see the §6 board
entry on unquoted products for why. `54dff5d7`, a `BG09RL-EXW` duplicate carrying
nothing across **all ten tables holding a `product_id`**, retired 2026-09-08.

### The three that were left, and why each is not a cleanup

- **`BG09RL-EXW`** — resolved by script 38, the orphan being unreferenced.
- **`BUC-157 KU2607001`** — the two rows have **split the evidence**: `c8f3d2d2`
  ("CO bag") holds the purchase order line, `ab86a997` (created 2 Sep, the better
  name) holds the quote. Which is the real product is a decision, not a merge.
- **`LL1-1618`** — **two different products sharing one SKU**, a green youth swim
  shirt and a pink girls shirt, each with three regulation links. Merging would be
  wrong; one needs a new SKU.

Both go to Kristy, with the null-SKU **Koozie with magnet** (`78dffbc0`), which
cannot be matched or linked until it has a SKU.

**On `BG09RL-USA` and `BG09RL-INT` being inactive** — deliberate, and **not**
script 28, which excluded those suffixes explicitly: *"Costing bases (`-EXW`,
`-Landed`, `-INT`, `-USA`) are excluded — those are script 14's park, not sizes."*
So they were hand-set. Neither column can prove by whom: `origin` was never used to
mark retirement (164 of 165 retired rows carry none), and **`updated_at` is
advanced on only 2 of 350 product rows**, confirming §4's note that this table
never maintains it.

---

## Sales orders reach products — 2026-09-09, scripts 41, 39 and 40

Prerequisite work for the lifecycle model in `PLM.md`. **No sales order line linked
to a product — 0 of 255** — so revenue could not be attributed to a product by
anything but a string, and the derived lifecycle ended at Delivered.

### 41 — the constraint was wrong, not the script

Script 39 aborted at its first write with `23505` on
`sales_order_items_sales_order_id_product_id_key`. **`UNIQUE (order_id,
product_id)` encodes "one line per product per order", and that is false here** —
sizes, price breaks and split deliveries all legitimately repeat a product.

Twelve rows in four groups collide, and all four are the same shape: one product
in several sizes on one order. Three carry the size in the `size` column (CHP
Sweatpants / Sweatshirt / PT Tee, L/M/XL). The fourth, `LL1-380` on SO 119909,
carries **Small / Medium / Large in the description** with `size` NULL, at 1600 /
1200 / 800 units and three different client prices.

That fourth group is why the obvious narrower constraint fails. `UNIQUE (…, size)`
would let it through **only because standard UNIQUE treats NULLs as distinct** —
and by the same rule would then permit unlimited unsized duplicates, ceasing to
constrain exactly where it currently works. `NULLS NOT DISTINCT` (available on
17.6) closes that hole and therefore *still* blocks LL1-380, which would mean
rewriting prose on issued sales orders to satisfy a constraint already shown to be
wrong.

**Both constraints dropped.** Nothing depends on them: no `upsert` or `onConflict`
anywhere targets an order item, and neither the SO form nor the PO document
assumes one line per product. `id` remains the primary key, so row identity is
untouched.

**It also clears half of script 14's park.** §5 records this same constraint
stopping 9 of its rows — three groups of three lines resolving to one product on
one PO, the identical shape. The other half, *which* product the `-EXW`/`-Landed`
rows are, is a decision and stays with Kristy.

### 39 — 231 of 255 linked, in three passes of decreasing confidence

| Pass | Rows | Basis |
|---|---|---|
| 1 | 49 | `quote_id` → `quotes.product_id`, exact, no string compared |
| 2 | 78 | `client_sku` matches exactly one selectable product |
| 3 | 104 | `client_sku` matches exactly one retired product |
| — | 24 | left alone: 19 ambiguous-retired, 1 ambiguous-selectable, 4 no match |

Each pass has its own check, so one pass over-reaching into another's rows fails
loudly rather than averaging into a single total.

**Pass 3 links to retired products deliberately. Retirement does not unsell
history.** These are real past sales of SKUs since taken out of service. Refusing
them would leave 41% of the table unlinked forever to protect a rule that is about
*new* work — the same line the inactive-SKU block draws, which leaves 154
historical quotes editable.

`client_sku` and `description` are snapshots of issued sales orders and were
asserted unchanged on all 255 rows.

### 40 — a compliance record pointing at the wrong product

SKU `JON-106` exists twice: `61d55187` "Wine Chiller" (**retired**) held the only
report, while `138427ce` "Wine Container White" (**selectable**) declared `passed`
and an eFiled date with **no report at all**.

The relink was not taken on the SKU match — attaching a report to the wrong
product is worse than leaving it detached. **The report names its own subject**:
`sample_description` reads *"Wine Container White"*, character for character the
selectable twin's name, asserted by length. `style_ref` is `JON-106`, result
`pass`, test date 2026-05-28.

Two findings recorded with it. **Both twins carry `efiled_date 2026-08-19`** — one
filing recorded against two rows for one item. And the eFiled date could only be
judged once the report was attached; it sits *after* the test date, which is the
right order.

**`LLF-1617` looked identical from outside and is not.** Neither twin holds a
report; both declare `passed` with no evidence anywhere. Nothing to relink — a
question for a person.

### What now writes `product_id` going forward

Two code paths, no trigger. Inferring a product from a string is a guess, and a
trigger is the wrong place to guess.

- **SO creation** resolves it from the quote already in hand — `quotes` is loaded
  with `select('*')`, so the row carries its own `product_id`. Resolved at the
  insert rather than threaded through the three seeding sites, so a fourth added
  later inherits it.
- **Lines with no quote** go through `ensureProductForQuote`, which carries the
  inactive rule with it: a new line can never adopt a retired product nor mint a
  duplicate of a retired SKU. An existing line's `product_id` is never re-pointed
  by an edit — editing a price is not a statement about which product a line is
  for.

---

## PLM Phase 1 as built — 2026-09-09, the derived lifecycle panel

Read-only, **zero database changes, no new table**. Every event derives from a
foreign key that already existed.

**`LifecyclePanel` is a standalone component keyed on `product_id`**, embedded in
the Testing page's product modal — deliberately not written inline, so Phase 2's
program page embeds the same one rather than a copy. That is the mistake
`lib/tierCost.js` and `lib/bankFields.js` were each created to undo.

**Where it could NOT go, and why.** There is no product detail view in this app.
The Products page renders *quotes*, and its `ProductDetailModal` takes
`quote: initQ` despite the name — one product appears on three rows when three
quotes name it. The Testing page is the only list whose rows are actually
products, so its modal is the only product-keyed surface that exists.

**Four queries, on demand at mount.** Quotes, test reports, PO items (with the
`purchase_orders → shipment_pos → shipments` embed the Inventory page already
uses) and SO items. For one product that is four indexed lookups; doing it for a
185-row list would be a fan-out nobody wants, which is why there is no timeline
column.

### What it shows, measured 2026-09-09

Derived stage across the 185 selectable products — **Phase 0.5 changed this
materially**, since Sold became reachable:

| Derived stage | Products |
|---|---|
| no event at all | 21 |
| quoted only | 94 (was 125) |
| quoted and tested | 1 |
| ordered | 1 |
| **sold, no PO** | **32** |
| sold and ordered | 32 |
| landed | 4 |

**The 21 with nothing get an explicit inventory of absence**, not an empty state —
"No quote names this product / No test report is linked / It appears on no
purchase order / It appears on no sales order". These are invisible on the
Products page because it renders from quotes and they have none, so this panel is
the first place they can be seen at all; a blank box would repeat the
invisibility.

**A persistent, non-dismissable testing-coverage line**: 73 of 84 reports are
unlinked and 71 name SKUs not in the catalogue. Without it, a missing Tested row
reads as *untested* when it usually means *untracked* — a compliance-shaped
misreading.

### A correction to what 148c4fc claimed

**That commit message says "The badge reads 185 rather than 351". It did not.**
The change moved `totalCount`, which only feeds the `n of m` indicator shown while
searching. The tab badge is a SEPARATE expression built inline from
`products.length`, and it kept reading 351 for a day while every other number on
the page read 185.

Fixed here, so the badge now counts the selectable catalogue like the tiles and
the filter counts. Recorded rather than quietly corrected because the commit
message is immutable and will keep saying otherwise.

**The lesson is the same one the `n of m` and tile numbers already taught**: a
page can hold two counts of the same thing built in two places, and changing one
looks like changing both. Three expressions still read `products.length` on that
page and all three are correct -- the catalogue-status filter, whose All genuinely
means all 351, and `ProductsView`, whose `products` prop is already filtered.

### Exception badges ship OFF

`LIFECYCLE_EXCEPTIONS_ENABLED = false`, one constant, no other change needed to
flip it. The logic is computed regardless so it is exercised rather than sitting
untested until the day it ships.

They are off because **product identity is a prerequisite**: several
contradictions are duplicate-product problems in a lifecycle costume. `LLF-1617`
declares `passed` on *both* twins with a report on neither; `JON-106` needed a
report relinked rather than a status changed. A badge whose first output is "you
have two products" teaches people to ignore badges. They switch on once Kristy
answers LLF-1617, BUC-157 and LL1-1618.

**ON since 2026-09-10.** All three identity questions closed:

| | how | result |
|---|---|---|
| `LLF-1617` | script 37 | twin holding no quote retired; one active row, 2 quotes |
| `BUC-157` | script 42 | PO line moved to `ab86a997`, `c8f3d2d2` retired, 0 refs left |
| `LL1-1618` | renamed by hand | `LL1-1618 Green` + `LL1-1618 Pink`, both kept, 0 bare `LL1-1618` left |

**Measured before flipping, which is what the gate was for rather than a
formality.** Across **184 selectable products, exactly one fires a badge** —
`LLW-1388`, declared Production with no purchase order and no sales order, which
is the row Phase 0.5 had already flagged for precisely this. The
ordered-or-sold-but-never-quoted rule fires on **nothing**, because scripts 39
and 14 linked the orders that would have tripped it.

One badge on 184 products is the outcome the gate existed to guarantee. If a
later change makes these fire on dozens, that is the signal to narrow the rule,
not to hide the badge — the two deleted classes are the precedent.

## Script 45, as run — 2026-09-10, purchase order lines reach products

`z0` on rehearsal and commit. **71 of 156 unlinked lines linked**, in two passes.
Verified live afterwards: 169 linked, 85 unlinked, Ordered coverage **37 → 53** of
184 selectable products.

### It could not reuse script 39's ladder

Script 39's Pass 1 was worth 49 rows and needed no matching at all — the sales
order line already carried `quote_id`, and the quote carried `product_id`. **No
such column exists on `purchase_order_items`**, and `master_sku`, `vpn`,
`pack_sku` and `baby_sku` are **empty on all 156** unlinked lines. Description is
the only signal, so the confidence ladder had to come from *match quality*:

- **Pass 1, 60 lines** — the description matches exactly one product in the whole
  catalogue, and it is selectable. Nothing to choose between.
- **Pass 2, 11 lines** — several products carry the name, exactly one is
  selectable, the rest retired. Script 39's Pass 3 in reverse: there it took a
  retired match because no live one existed; here it takes the live one because
  the twins are history.

Case never mattered — 0 of 156 resolve differently case-sensitively, and `a5`
proves it rather than assuming it.

### Every one of them was an issued document

**156 of 156 sat on non-draft POs. Zero drafts.** And all 156 carried
`product_sku` NULL, so they printed no SKU at all. `trg_poi_stamp_product_sku` is
`BEFORE INSERT OR UPDATE OF product_id`, so every link would have put a SKU in
front of a factory that had never seen one — script 14's problem at 18× the
scale, and it took the same answer: **link, then null the snapshot.** Net effect
is `product_id` on 71 lines and not one printed document changed.

### 71 lines, but only 16 new products

The 71 reach **17 distinct products, 16 of them new to Ordered** — most of those
lines are sizes and repeats of the same product on the same purchase order. Worth
remembering when a line count is used as a proxy for coverage: it moved coverage
by 16, and still leaves **131 of 184 products with no linked purchase order**.

---

## Script 46, as run — 2026-09-10, names that began with their own SKU

`z0` on rehearsal and commit. **11 selectable product names stripped**, 20 retired
ones deliberately untouched. Verified after: 0 selectable rows still carry the
prefix, 20 retired ones still do, and `LLW-1545` now reads `Blue Bottle Bubble
Bath`.

Found because Matt recognised `Blue Bottle Bubble Bath` — written up here as a
missing product — as `LLW-1545`, whose *name* carried its own SKU. **31 products
had the pattern.** A product named `LLW-1545␣␣␣␣␣Blue Bottle Bubble Bath` is not
named `Blue Bottle Bubble Bath`, so it matches nothing and looks missing while
sitting in the catalogue.

### Literals, not a regular expression

The new names are eleven written-out strings. Computing them would need a
backslash character class, or a POSIX class carrying colons, and collapsing runs
of spaces would need a two-space literal — **all three are barred by the transport
rules**, each for a reason that has already cost a rehearsal. Eleven literals are
reviewable on sight and guarded by `id` plus the exact old `length(name)`.

Preflight caught three real faults on this file's first run, including `b4`
selecting a bare `p.sku` — **rule 7 doing its job one script after it was added**
for exactly that.

### It links nothing by itself

`c3` asserts that: unlinked lines are unchanged at 85. Script 46 only makes one
line *resolvable*.

**The follow-up is a re-run of script 45's logic, and script 45 cannot be re-run
as written** — its wants are the measured literals `60`, `11`, `71`, `85` and
`37 to 53`, so a second run fails at `a0` rather than doing nothing, which is the
guard behaving correctly. Re-measured after 46: pass 1 now resolves **1** line
(`Blue Bottle Bubble Bath` → `LLW-1545`), pass 2 resolves 0, and coverage would
move **53 → 54** of 184. A one-line script with its own wants, not an edit to 45.

---

## Scripts 53 to 56, as run — 2026-09-15

All four `z0` on commit and verified from a fresh query afterwards. 53, 54 and 56
were `z0` on their first rehearsal; 55 took two, for the reason recorded under it.

### 53 — `purchase_orders.production_pct` exists

`smallint NOT NULL DEFAULT 0`, `CHECK (production_pct BETWEEN 0 AND 100)`. A
constant default, so no table rewrite; all 68 purchase orders read 0 on commit.
The constraint was **exercised, not just asserted**: a probe wrote −1, 0, 10,
100, 101 and null to a real row, each inside a subtransaction forced to roll
back, and read back 0 / 10 / 100 accepted and −1 / 101 / null rejected. A
fingerprint of every `id|updated_at` proved the probe left nothing. Why the column
was needed is in the next section.

### 54 — the legacy PLM tables, `inquiry`, and `order_date NOT NULL`

- **`programs_legacy`, `program_tasks_legacy` and `program_notes_legacy` dropped**,
  children first and without `CASCADE`, then `touch_program_stage()`, whose only
  user was a trigger on `programs_legacy`. A guard refused to drop anything unless
  the tables still held 1 / 8 / 0 rows — exactly what
  `archive/2026-09-15-programs-legacy-BUC_157.json` holds, committed in `5489968`
  and hash-checked row for row against the live tables before it went in.
- **`programs_declared_stage_check` narrowed** to `declared_stage IS NULL OR
  declared_stage = 'sampling'`. No row had ever carried `inquiry`.
- **`order_date SET NOT NULL`** on `purchase_orders` and `sales_orders`, the
  `CURRENT_DATE` defaults kept. It ran **after** `5489968` made the date required
  on all four order forms: clearing the field used to send an explicit null, which
  does not fall back to a default, so without that app change those saves would
  have become raw database errors.

Both new constraints were probed the same way as 53.

### 55 — `rename_product_sku` loses `p_program_ids`

Dropped and recreated with seven arguments, because `CREATE OR REPLACE` cannot
remove a parameter. The body was **generated from script 51, not retyped**, and
only once its fingerprint matched the live body (`d2e9155f…`, line endings
normalised) — it still matches afterwards.

A new function keeps none of the old one's settings, so three things were
re-applied by hand:

- **the grants** — revoked from `PUBLIC` and granted to `authenticated`, because a
  fresh `CREATE FUNCTION` hands `EXECUTE` to `PUBLIC`, and `anon` inherits it;
- **`search_path`**, with `SECURITY INVOKER` now written out rather than implied;
- **the function comment**, which a drop discards silently and nothing else would
  have noticed.

Two probes ran, both undone even on commit. A call naming `p_program_ids` is now
refused as an undefined function. And a throwaway `ZZTEST-OLD-55` product was
renamed **through the function, by argument name** the way PostgREST calls it,
inside a subtransaction forced to roll back: it reported
`products.sku ZZTEST-OLD-55 to ZZTEST-NEW-55 true`, and the row read the new SKU.

It ran a day earlier than planned, which was safe because `5489968` had already
stopped the Rename SKU modal sending the argument, and the old signature
defaulted it. A browser tab opened before that deploy still sends it, and now gets
a 404 from PostgREST before Postgres is called — nothing is written, and a reload
fixes it.

**What its rehearsals taught.**

- **`COMMENT ON` takes a string literal, never an expression.** Written verbatim,
  the comment trips preflight's boolean-equality rule on its own words,
  `(changed = false)`, so the `=` was built with `chr(61)` — and the first
  rehearsal failed with 42601 at `||`, because a literal-only statement cannot
  evaluate a concatenation. It rolled back with nothing changed. The comment is now
  applied through `EXECUTE format('comment on function … is %L', <expression>)`
  inside a DO block, and `c3` compared the stored comment's fingerprint with the
  old one. The same applies to any statement whose grammar wants a literal.
- **Preflight bans `regexp_replace` anywhere in a script.** The check that the body
  names no `programs` table outside its comments cuts each line at its first `--`
  with `string_to_table` and `split_part` instead, so the tombstone comments script
  51 left in the body cannot fail it.

### 56 — same-SKU twins merged

23 quotes re-linked and 23 empty programs deleted; see *Same-SKU twins merged*
below. Numbered 56 because 55 was already reserved for dropping `p_program_ids`;
55 then ran the same afternoon.

### Verified from outside

| | before | after |
|---|---|---|
| legacy tables / `touch_program_stage` | 3 / 1 | **0 / 0** |
| `rename_product_sku` arguments / overloads | 8 / 1 | **7 / 1** |
| `rename_product_sku` `EXECUTE` — `anon` / `authenticated` / `PUBLIC` | false / true / none | **false / true / none** |
| programs | 335 | **312** |
| quotes / PO lines / SO lines / products | 332 / 256 / 258 / 352 | unchanged |
| PLM board — pipeline / archived / retired | 89 / 194 / 52 | **89 / 194 / 29** |

---

## Script 58, as run — 2026-09-16, fourteen products retired

`z0` on the first rehearsal, and verified from a fresh query afterwards.

**This undoes half of script 52 on purpose.** Move B of 52 turned 30 products from
`false` to `true` because they carry purchase order lines — a product somebody had
bought was taken to be a product in service. The definition since settled is
different and simpler: **Inactive means retired from new use, whatever the order
history says.** Order lines are history; `active` is a decision about the future. 52
was right about the facts and wrong about the question.

**Fourteen, not thirty.** The other 16 List-B rows were retired by hand on the
Products page earlier the same day. The script names those 16 by id too, and checks
they are all still inactive and that it did not touch them.

**Nothing about the orders changed.** Every purchase order line, sales order line and
quote these products carry is exactly where it was — `b5` proves all fourteen still
have their PO lines, and `c2` proves no line, quote or program row moved. A retired
product keeps its history; what it cannot do is reach a **new** line, which the app
has enforced since `f9619c2`.

All fourteen are BucketGolf: the six `BG-104` size rows, and `BG06-USA`, `BG09-USA`,
`BG09RL-INT`, `BG09RR-INT`, `BGLHTC-INT`, `BGLHTC-USA`, `BGRHTC-USA`,
`BGTurfPad-INT`. Six of them share a SKU with a sibling that was already retired, so
every row carrying those SKUs is now inactive — which leaves the **parent** `BG-104`
as the orderable row, made active by script 59 the same afternoon.

`archive/2026-09-16-list-b-retired.json` holds all fourteen as they stood, with the
order and quote counts the claim above is read against.

### Verified from outside

| | before | after |
|---|---|---|
| `active` — true / false / NULL | 88 / 153 / 110 | **74 / 167 / 110** |
| the fourteen, inactive / carrying PO lines | 0 / 14 | **14 / 14** |
| products / quotes / PO lines / SO lines | 351 / 332 / 256 / 257 | unchanged |
| PLM board — pipeline / archived / retired | 90 / 192 / 30 | 89 / 192 / 30 |

**The board did not move because of this script.** All fourteen carry order lines, so
their programs stay Archived rather than dropping into the retired bucket. The
pipeline reading one lower is a *program* deleted by hand between the two
measurements — BUC-138 went from two programs to one — and `c2` had already proved
the script left the program count alone.

**What preflight caught.** The first draft identified those 16 rows by script 52
timestamp. A time of day written as a literal carries colons, and `:5` is exactly
what a bind-parameter rewriter reads as a parameter, so the rule fired six times —
twice per copy of the literal. They are named by id now, which is the identity rule
this codebase already follows. **A timestamp is not an identifier.**

---

## The PLM rework — 2026-09-17, a board people keep by hand

Riley wanted PLM manual. Four commits and one script, in an order chosen so the
table could never refill from a door that was still open.

### Why the derived board went

It was not wrong. It measured real things — `PLM.md` records what it found — and
it kept itself current without anybody maintaining it. It was replaced because
**a board that moves on its own cannot be a board somebody is accountable for.**
There was no owner, no way to say *this is mine and it is at sample two*, and no
way to be deliberately wrong. The records are still on the card; they just no
longer vote.

### The order mattered

**`99830b0` closed every door first**, before script 60 emptied anything. Six
automatic call sites, not the five Riley listed — Edit SO had two, one on the line
insert and one after the product was resolved — plus *Sync from records* and
*Mark won*.

**Mark won was not on the list**, and went anyway. It is a button a person
presses, so it reads as manual, but it called `ensurePrograms` directly and would
have opened a card with **no owner and no stage** — the two things the new model
requires. It returned in `6b7d4a4` wired to the new helper. The general shape:
*manual* is not the same as *deliberate*, and a control that creates a row the new
model cannot describe is a door however it is labelled.

Had the script run first, every quote and order saved in the gap would have
refilled the table.

### Script 60, as run

`z0` on the second rehearsal. All 314 programs deleted, the `declared_stage` CHECK
widened from *NULL or sampling* to the nine manual stages, `owner_id` added as a
key into `staff_profiles` with `ON DELETE SET NULL`, and `programs_owner_idx` with
it.

**No `stage_changed_at` column**, because `declared_stage_at` already existed and
`trg_programs_declared_stage_at` has stamped it with `clock_timestamp()` since
script 49. The manual board reads it as a card's age — which is the one thing the
derived board could never say for Sampling, where nothing recorded the change.

**The guard refused unless `program_notes` held zero rows.** Notes cascade on
delete, and they are append-only prose somebody typed; a delete that quietly took
them would have been the wrong kind of clean start. Three probes, rolled back even
on commit: a real stage inserts, the old `sampling` value is refused by the CHECK,
an unknown owner is refused by the key.

**What the first rehearsal taught.** `create temp table t_probe on commit drop
(name text, got text)` is a 42601. Both orders look right because both *are* —
the `AS query` form takes the clause first and every other temp table in these
scripts is written that way; the column-list form does not. Preflight gained
**Rule 10** for it, proven against a throwaway file carrying all three forms
before it was trusted.

### Verified from outside

| | before | after |
|---|---|---|
| programs / program_notes | 314 / 0 | **0 / 0** |
| stages in the CHECK | NULL or `sampling` | **nine, `sampling` gone** |
| `owner_id` + FK + index | none | **present** |
| `declared_stage_at` trigger | attached | unchanged |
| products / quotes / PO lines / SO lines | 352 / 333 / 259 / 260 | unchanged |

`archive/2026-09-17-programs-before-manual-reset.json` holds all 314 rows —
committed **before** the delete, on Riley's instruction, not after.

### The board that replaced it

Eight columns — Quoted, Sample 1 to 5, Testing, Purchase Order — and a ninth,
*No stage set*, that appears **only when a card is in it**. A permanent empty
column is a standing invitation to a state nothing produces.

**Sample is five rungs** because a sample round is the thing that repeats here,
and one Sampling column could not say whether a card had been round once or five
times.

**Unowned is an option with a count**, not an absence. A card whose creator
resolved to no staff row is the one state worth finding, and a filter that could
not express it would hide exactly that.

**Reassignment writes its own note** through `program_notes`, which is append-only
by grant — `authenticated` holds INSERT and SELECT and nothing else — so the
record cannot be tidied afterwards. The note is written *after* the owner update
lands, and a failed note leaves a correct owner and a missing line, which is the
better way round.

**What the system knows** is the old derivation, demoted to a read-only block that
says in words that it moves nothing. Throwing the records away would have been a
loss; obeying them would have been the old board.

### What was removed rather than left to look live

`ProgramLadder` (99 lines), the `COL` colour table, the whole derived-completion
path in `enriched` and its `firstOrder` feeder in `buckets`, and five imports —
`PIPELINE_STAGES`, `stageEnteredAt`, `isComplete`, `completionOf`, `PICK`. That
derivation filled five fields no render site read any more. Dead computation next
to live computation is how the next person learns the wrong rule.

### Open

`expected_ship_date`, `factory_status`, `factory_pct` and `factory_reported_at`
are still columns on `programs` and nothing on the new board reads or writes them.
Either they are part of the manual card or they are columns to drop — a question
for Riley, not an assumption to make.

---

## Script 61, as run — 2026-09-18, the duplicate TRE-011 quote removed

`z0` on the first rehearsal, and verified from a fresh query afterwards.

**One save, two rows.** Saving the TRE-011 quote inserted `7c976a19` and then
`8b6eb449` 1.5 seconds later. The first carries both links — product `877c38f2`,
company `ee8455ed`. The second is a shell: same SKU, same product text, same client
text, same single tier at 2000 units and 10 landed, but `product_id` and
`client_company_id` both NULL, because the linking steps that follow a save ran
against the first row and never against the second. Loren asked for the shell to go.

**Nothing referenced it, and that took measuring rather than assuming.** There is
**no foreign key anywhere in this database pointing at `vessl.quotes` or
`public.quotes`** — every reference is by convention, so the database would have
allowed the delete no matter what pointed at the row. Twelve paths were counted by
hand and then counted again inside the transaction, into `_r61`, so the guard and
the checks read the same numbers rather than trusting a measurement taken the day
before. All twelve read zero. `programs` and `program_notes` are both empty and
neither carries a quote column, so there was no card and no note to orphan.

**A claim corrected on the way.** The shell was first described as carrying the
signature of a double-submit because its `updated_at` precedes its own `created_at`.
That is not a signature: **94 of 339 quotes have it**, average gap 0.265s, because
the app stamps `updated_at` client-side before the insert lands. What is singular
about the shell is the *size* of the gap — 2.597s, the largest in the table. The
duplicate evidence is two same-SKU rows 1.5 seconds apart with one unlinked.

**No timestamp literal appears in the script, and that shaped a guard.** A timestamp
carries single colons and the SQL editor rewrites those as bind parameters, which is
what cost script 58 a rehearsal. So "nobody has edited this row since it was
created" is asserted as `updated_at < created_at` — true of it today, and false the
moment anybody saves the row, because a save stamps `updated_at` with the current
time. The property does the work a literal would have done, and survives transport.

**Counts asserted as differences, not absolutes.** `quotes` moved from 338 to 339
while the script was being written — an unrelated quote saved in the gap. An
absolute `want` would have failed a perfectly good run, the same argument script 37
makes for the same reason.

`archive/2026-09-18-duplicate-quote-TRE-011.json` holds the row as it stood, every
column, beside a summary of the row kept and all twelve reference counts.

### Verified from outside

| | before | after |
|---|---|---|
| quotes | 339 | **338** |
| rows carrying SKU `TRE-011` | 2 | **1** |
| Tremont Sporting Co quotes | 12 | **11** |
| the shell `8b6eb449` | present, both links NULL | **gone** |
| survivor `7c976a19` — links / tiers | `877c38f2` + `ee8455ed` / 1 | unchanged |
| product `877c38f2`, company `ee8455ed` | present | unchanged |
| programs / program_notes | 0 / 0 | unchanged |

### preflight.py had vanished, and is now in the repo

It was not in the repo, not in `scratchpad/`, not anywhere — it had only ever lived
in a session scratchpad, which rolled over. Every rule it enforces is recorded in
this file and in the session memory, so it was rewritten from those.

**Its first run failed script 61 twice, and both were bugs in the checker.** Rule 10
flagged `create temp table … on commit drop as select …`, which is the *correct*
form, because the first open paren it found belonged to the select body. The test is
narrower than the first draft assumed: flag only when the next non-whitespace
character after the clause is an open paren. The AS form has `as` there; the correct
column-list form has a semicolon.

**Then it was made to prove it can fail**, because a checker that cannot detect its
own fault class is worse than none — the first lexer written for this job skipped
newlines before testing whether it was inside a string and reported PASS on the very
bug it existed for. Two throwaway files: one carrying a backslash, a single colon in
a comment, an apostrophe in a comment, a double space in a literal, the broken rule
10 form, a first branch missing `as got`, a live `commit;` and no trailing rollback —
**all eight fired**; and one carrying the script 42 fault, an uncast `got` reading an
enum — **rule 7 fired**. Rule 9, the absence check, is unproven and does not apply
here. It now lives at `scratchpad/preflight.py`, committed, so it stops disappearing.

### Open

**The Save button has no double-submit guard.** This row exists because a save ran
twice, and nothing in the quote form prevents it happening again. The duplicate is
cheap to remove once; the guard is the actual fix and is not written.

---

## Script 62, as run — 2026-09-18, who touched the card last

`z0` on the first rehearsal. Adds `vessl.programs.updated_by`, text, NULL. One
column, nothing else.

**`updated_at` was already there and already being stamped by hand.** What was
missing was the name beside it, so a card could say when it last moved but never
who moved it. There is no trigger on this table doing either — the only one is
`trg_programs_declared_stage_at`, which stamps the stage date on insert and on a
stage change. The application does `updated_at` itself, on every write, and now
does `updated_by` the same way: a stage move from the modal or from a drag, an
owner change, and adding, editing or deleting a note.

**NULL is a real value and the column is deliberately nullable.** Every row that
existed predates the stamp, and backfilling a name onto a change nobody recorded
would be inventing evidence. An empty last touch reads as not recorded, which is
exactly what it is — the one existing card showed that until it was next moved.

**Text, not a key into `staff_profiles`.** `owner_id` is a key because an owner is
somebody the board assigns work to and a typo there breaks a filter. This is an
audit crumb: it has to stay readable after a colleague leaves and their profile
goes. The interface resolves it to a full name when a profile still matches and
shows the raw address when none does.

**Counts asserted as differences.** The table held zero rows that morning and one
by the afternoon, because a card was made while testing. An absolute want would
have failed a good run for a reason unrelated to the script.

### Verified from outside

| | before | after |
|---|---|---|
| `programs` columns | 13 | **14** |
| `updated_by` | absent | **present, text, nullable** |
| rows | 1 | unchanged |
| `trg_programs_declared_stage_at` | attached | unchanged |

---

## Script 63, as run — 2026-09-18, a note can be corrected by whoever wrote it

`z0` on the first rehearsal. Adds `edited_at` and `deleted_at` to
`vessl.program_notes`, grants UPDATE on three columns, and adds a RESTRICTIVE
policy confining those updates to rows the caller wrote.

**This reversed the append-only decision, narrowly.** Script 48 left
`authenticated` holding SELECT and INSERT and nothing else, and the comment on the
notes component said so proudly. The reason it reversed is simpler than the reason
it was made: somebody typing a note into a card gets it wrong sometimes, and a
record nobody can correct is a record people stop trusting.

**Append-only was a GRANT property, not a policy one — and that changed the shape
of the script.** `program_notes` carries one policy, `staff_only`, `FOR ALL` and
permissive, which already permitted UPDATE at the policy layer. Permissive policies
OR together, so a second permissive policy would have confined nothing. The author
check had to be **RESTRICTIVE**, which ANDs — the same pattern `vessl.quotes`
already uses with its restrictive `kui_staff_only`.

**The grant is per column, and that is where the real safety is.** `authenticated`
gained UPDATE on `note`, `edited_at`, `deleted_at` and nothing else, so a note
cannot be reassigned to another author or backdated regardless of policy. Column
privileges live in `pg_attribute.attacl`, not `relacl`, so the checks read them
through `has_column_privilege`, which answers for a named role from any connection.
`information_schema.role_table_grants` would have returned nothing here — it only
shows grants involving the current role — and a check reading it would have passed
vacuously.

**No probe, deliberately.** The SQL editor runs as the table owner and RLS does not
apply to the owner, so a probe could only have proved that owners can do owner
things. The grants *are* tested; author-only enforcement was verified in the
application, signed in as two different people. A role-switched probe was
considered and rejected — after `set local role authenticated` the block loses
privileges on its own temp table.

**What preflight caught.** One branch whose `got` was a bare `case … end` with no
cast. A second branch of the same shape escaped only because an unrelated
`relacl::text` sat in its segment — the rule passed it by accident, not by being
right, so both were cast.

### Verified from outside

| | before | after |
|---|---|---|
| `program_notes` columns | 6 | **8** |
| policies | 1 permissive ALL | **2, the new one RESTRICTIVE/UPDATE** |
| `authenticated` table UPDATE | false | unchanged, still false |
| column UPDATE on note / edited_at / deleted_at | none | **granted** |
| column UPDATE on author | none | unchanged, still none |
| rows | 1 | unchanged |

---

## Script 64, as run — 2026-09-18, delete means delete

`z0` on the first rehearsal. Grants DELETE on `vessl.program_notes`, adds a
RESTRICTIVE policy confining deletes to rows the caller wrote, and drops the
`deleted_at` column script 63 had added hours earlier.

**It reverses 63's soft delete, and the speed is the point rather than an
embarrassment.** 63 shipped `deleted_at` plus a filter that hid the row, on the
reasoning that a note is a record and a record should not be destroyable. One
round of using it changed the answer: a note nobody can see and nobody can remove
is a row that only accumulates, and the list it hides from is the only place
anybody would ever read it. Hiding was protecting the wrong thing.

**What protects a note now is that it is yours.** The delete policy is the same
shape as the update policy 63 added — same `btrim`/`lower`/`coalesce` comparison
against the token address, same empty-author exclusion, so a row nobody signed is
deletable by nobody. `USING` only, with no `WITH CHECK`: a delete produces no new
row, and Postgres accepts no check expression there.

**`edited_at` stays.** It records that words changed after they were written, which
is still true and still worth saying on the card. Only `deleted_at` goes.

**The guard proved the drop lost nothing rather than assuming it.** `deleted_at`
was set on zero rows, measured immediately before writing. Had anything been soft
deleted between 63 and this, the guard refuses and the column stays until somebody
decides what those rows are.

**No probe, for the same reason 63 had none** — the editor runs as owner, RLS does
not apply to owners. The grant is tested for real by `has_table_privilege`;
author-only enforcement was verified in the application.

**A numbering note for anyone reading the files.** 64 was written *after* 65, which
is why the two sit out of order in the working tree. 63 briefly occupied the slot
in conversation that 64 ended up filling; the files themselves are correct.

### Verified from outside

| | before | after |
|---|---|---|
| `program_notes` columns | 8 | **7** |
| `deleted_at` | present, set on 0 rows | **dropped** |
| `edited_at` | present | unchanged |
| `authenticated` DELETE | false | **true** |
| policies | 2 | **3, the new one RESTRICTIVE/DELETE** |
| rows | 1 | unchanged |

---

## Script 65, as run — 2026-09-18, three sample rungs become one Sampling stage

`z0` on the first rehearsal. Narrows `programs_declared_stage_check` from the nine
values script 60 gave it to five plus null — `quoted`, `sampling`, `testing`,
`purchase_order`, `complete` — migrating any row on a numbered rung first.

**What the CHECK allowed, re-measured rather than taken from 60:** `NULL, quoted,
sample_1, sample_2, sample_3, sample_4, sample_5, testing, purchase_order,
complete`.

**Why the rungs went.** They were built on the reasoning that a sample round is the
thing that repeats at KUI and one column could not say whether a card had been
round once or three times. Nobody used the fourth or the fifth, the board capped at
three within a day, and how many rounds a product has been through turned out to be
something people write in the notes rather than record by moving a card. A stage
that says sampling is happening is the honest shape.

**Zero rows moved, and that was measured rather than expected.** `programs` held one
row and it sat on `quoted`. The migration UPDATE is in the script anyway, for a card
created between writing and running — and it runs **before** the constraint swap,
because the other order fails on any row still holding a rung. Same lesson the PLM
rework recorded about doors and scripts.

**The probe is real here, unlike 63 and 64.** A CHECK applies to the owner too, so
the script proves the new constraint by trying it: `sampling` inserts, `sample_1` is
refused, both inside subtransactions forced to roll back.

**A defect this change introduced in the app, caught before it shipped.** The tiles
grid was a hardcoded `repeat(6,1fr)`. Collapsing six stages to four left four tiles
in a six-column grid with two empty slots — a stage list and a layout that disagreed
because only one of them knew the stages had changed. The grid now takes its column
count from `MANUAL_STAGES.length`.

**What preflight caught.** A single colon in the header prose — `not assumed:
vessl.programs` — the same class that cost script 58 a rehearsal. Rewritten without
it.

### Verified from outside

| | before | after |
|---|---|---|
| CHECK values | 9 plus null | **5 plus null** |
| numbered rungs in the CHECK | 5 | **0** |
| rows on a numbered rung | 0 | 0 |
| `programs` rows | 1, on `quoted` | unchanged |
| `programs_factory_pct_check` | attached | unchanged |

---

## Script 66, as run — 2026-09-18, sampling belongs to the product

`z0`, but only on the **second** rehearsal — and the first failure is the reason
this entry exists. Creates `vessl.product_notes` with the grants and policies
`program_notes` ended up with after 63 and 64, and adds `products.sample_date`.

**THE LESSON, AND IT APPLIES TO EVERY NEW TABLE IN THIS SCHEMA.** `b6` and `b7`
failed on the first run: after `CREATE TABLE`, `authenticated` already held
table-level UPDATE and column UPDATE on `author` and `kind`, which the narrow
grant was supposed to withhold. The cause is `pg_default_acl` — for schema
`vessl`, `postgres` grants `authenticated` **`arwdDxtm`** on every table created
in it. So a new table arrives with full rights already on it, and a narrow
`grant` beside a wide inherited one is decoration. **Revoke first, then grant.**
The script now runs `revoke all ... from public, anon, authenticated` immediately
after `CREATE TABLE`, and `b12` asserts `anon` holds nothing.

**Where the lesson stops.** `pg_default_acl` fires at `CREATE TABLE` and nowhere
else. A script that ALTERs an existing table inherits nothing and needs no
revoke — see 67 below, which grants additively and re-measures instead. Applying
the revoke reflexively to an existing table would take away rights somebody
granted on purpose.

**`service_role` is deliberately not named.** It is absent from the `vessl`
default and from every sibling table ACL, so there is nothing of its to take
away, and a revoke naming it would be a statement about a grant that does not
exist.

**No probe for the policies, as in 63 and 64.** The SQL editor runs as the table
owner and RLS does not apply to the owner, so a probe could only prove that
owners can do owner things. The grants are tested for real, by
`has_table_privilege` and `has_column_privilege`, which answer for a named role.

### Verified from outside

| | before | after |
|---|---|---|
| `vessl.product_notes` | did not exist | **7 columns, 0 rows** |
| `products` columns | 34 | **35** (`sample_date`) |
| table grants to `authenticated` | — | **select, insert, delete; no update** |
| column UPDATE | — | **`note`, `edited_at` only** |
| policies | — | **3** — permissive `staff_only`, restrictive author-only update and delete |
| `anon` privileges | none | none |

---

## Script 67, as run — 2026-09-18, a sample is an event, not a column

`z0` on the first rehearsal, and preflight passed first time. Adds `sample_date`
and `sample_stage` to `product_notes`, widens the `kind` CHECK to
`('sampling','sample_event')`, adds a CHECK that a sample event carries a date or
a stage, extends the column UPDATE grant to the two new columns, and **drops
`products.sample_date`** — the column script 66 had added a day earlier.

**Why 66 was wrong within a day.** One `sample_date` on the product can hold
exactly one round. A product is sampled more than once — that is the whole reason
the board carried Sample 1 through Sample 5 before 65 collapsed them — so
recording the second sample meant overwriting the first. The column could only
ever describe the most recent round while looking like it described the sampling.
A row per round keeps the history; two new columns on a table that already has an
author, a timestamp, an edit stamp and author-only policies cost one table
instead of two.

**The drop was guarded on a measured number.** `products.sample_date` was non-null
on **0** rows when the script was written — the ZZTESTPLM value that prompted the
tolerance had already gone. The guard refuses at more than one, so a real value
appearing between writing and running stops the drop rather than being eaten by
it; branch `a1` asserts the measured 0 separately.

**The `kind` CHECK is dropped and re-added, not altered.** Postgres has no
alter-in-place for a check body. Doing both inside the transaction means no
window exists where the table is unconstrained.

**No revoke here, deliberately.** This alters an existing table, so the schema
default privileges never fire — see the boundary noted under 66. The grant is
purely additive and `b8` through `b12` re-measure the result rather than assume
it, which is the half of the 66 lesson that does transfer.

**Sequencing that had to be got right.** `programs.jsx` selected
`products.sample_date`, and PostgREST fails the whole request on a missing
column — so running this against the old code would have stopped the PLM board
loading entirely. Script and app change landed together.

### Verified from outside

| | before | after |
|---|---|---|
| `product_notes` columns | 7 | **9** (`sample_date`, `sample_stage`) |
| CHECKs on `product_notes` | 1 | **3** |
| `kind` permits | `sampling` | **`sampling`, `sample_event`** |
| column UPDATE | `note`, `edited_at` | **`note`, `edited_at`, `sample_date`, `sample_stage`** |
| table-level UPDATE | not granted | not granted |
| `author` / `kind` writable | no | no |
| `products` columns | 35 | **34**, no `sample_date` |
| `product_notes` rows | 0 | 2 — both `ZZTESTPLM` sample events from the localhost pass |

---

## Script 68, as run — 2026-09-22, two company rows for one factory become one

`z0` on the first rehearsal, and preflight passed after one fix. Merges the
company `UPM` into `Universal Plastic and Metal Manufacturing LTD` — confirmed the
same firm — and removes the duplicate row.

| | |
|---|---|
| kept | `9ea6b132-6d75-421a-b770-d9deea39f9f0` Universal Plastic and Metal Manufacturing LTD |
| removed | `765b2a44-a681-4cff-860c-911fc577fa70` UPM |

**The duplicate was born of an upsert, seven weeks later.** The kept row was
created 2026-07-02 and carries all the history — 3 purchase orders, the only
contact. `UPM` was created 2026-08-27 by somebody typing a short name rather than
picking the company that already existed, and carries nothing.

**Nothing pointed at it by key, and that was measured across all of them.**
`vessl.companies` is referenced by **24 foreign key columns**, seven of them in the
`portal` schema. The list came from `pg_constraint` rather than from enumeration,
because a merge that leaves one orphaned key is a row nobody finds until it
errors. All 24 held zero. `b1` re-asserted every one at run time, so a reference
created between writing and running would have stopped the script.

**So the only live references were two pieces of free text.** `quotes.factory` had
2 rows reading `UPM`. Two *other* quotes already carried the full name and were
deliberately left alone — an update matching them would have changed nothing while
looking like it changed something.

**The company merge was a no-op, and the script says so rather than pretending.**
Every fillable column — phone, website, vendor_number, pallet_info, po_notes, both
addresses — was null on **both** rows. The only populated field was email, and the
kept row already had one, so never-overwrite left it alone. There is no `UPDATE`
on `companies` in the script because there was nothing for it to do.

**What that cost, stated rather than hidden.** `Crystal.zhang@upm.hk` was on the
removed row and its preset. Both survivors hold `dp4@upm.hk`, which is non-null, so
the never-overwrite rule dropped the Crystal address from structured data — no
contact row held it. It survives in the script's JSON archive and on the
`factory_email` of two quotes.

**The preset merge is where data actually moved.** The kept preset gained
`factory_contact`, `country` and `lead_time` — three fields it never had.

**What preflight caught.** `b5` read `coalesce(factory_email, …)` with no cast, no
`||`, no `string_agg`. Text at run time, but rule 7 exists because a UNION type
mismatch takes down the whole statement rather than one branch.

### Verified from outside

| | before | after |
|---|---|---|
| factory companies for this firm | 2 | **1** |
| UPM company row | present | **gone** |
| UPM preset | present | **gone** |
| kept preset contact / country / lead | — / — / — | **Crystal / China / 45-50** |
| kept preset email | `dp4@upm.hk` | unchanged |
| quotes reading `UPM` | 2 | **0** |
| quotes reading the full name | 2 | **4** |
| kept company POs / contacts | 3 / 1 | 3 / 1 |
| keys pointing at the removed id | 0 | **0** |

---

## Script 69, as run — 2026-09-22, one primary contact per company

`z0` on the first rehearsal, preflight passed first time. Demotes every primary
contact except the oldest where a company carried several, and promotes the oldest
contact where a company carried none. Touches `contacts.is_primary` and nothing
else.

**Why the data drifted, and it was the app doing it.** `is_primary` was a free
checkbox on the company card, so ticking one contact never cleared the others —
and **both** automated insert paths hardcoded it true. Both write to a company
obtained by `UPSERT`, so creating a company that already existed, or saving a quote
naming a new contact at an established client, added a second primary to a company
that already had one.

**Why it mattered rather than being untidy.** Two readers answer "who is the
contact here" — the company card and the export column — and both take the *first*
row flagged primary. With several flagged, the answer was whichever row the query
happened to return first, which is not a decision anybody made.

**Oldest wins, and the tie-break earns its place.** Order is `created_at` then
`id`. The contacts loaded in the bulk import of 2026-06-04 all carry an identical
timestamp, so `created_at` alone cannot order them and `id` is what decides. The
app uses the same order when it promotes after a removal, so the form and the
repair agree about who is oldest.

**Demote keeps the oldest already-flagged primary, not the oldest contact.** A
company that deliberately chose a later contact as its primary keeps that choice;
only the duplicates go.

**The arithmetic closes:** 18 primaries − 5 demoted + 4 promoted = **17**, one for
each company that has contacts.

| | count |
|---|---|
| companies carrying several primaries | 3 — Buc-ee's 2, **Legoland 4**, Peppa Pig 2 |
| rows demoted | 5 |
| companies carrying contacts and no primary | 4 — BucketGolf, Johnnie-O, Madame Tussauds, Ritz Carlton |
| rows promoted | 4 |

### Verified from outside

| | before | after |
|---|---|---|
| contacts | 30 | 30 |
| companies with contacts | 17 | 17 |
| rows flagged primary | 18 | **17** |
| companies with **exactly one** primary | 10 | **17** |
| companies with more than one | 3 | **0** |
| companies with none | 4 | **0** |
| the nine named rows | — | **3 kept true, 5 demoted false, 4 promoted true**, each checked by id |

---

## Script 71, as run — 2026-09-22, three spellings become the names the companies carry

`z0` on the **second** rehearsal — the first failed on one branch, and that failure
is the most useful thing in this entry. Re-points `quotes.factory` for three
strings naming companies the catalogue already held under a slightly different
spelling. **52 rows**, three aliases, no company row touched.

| alias | rows | becomes |
|---|---|---|
| `LIAONING KANGPING PLASTIC INDUSTRY CO.,LTD` | 44 | Liaoning Kangping Plastic Industry Co., Ltd |
| `Aung crown` | 7 | Aung Crown |
| `Baoquan` | 1 | Shenzhen Baoquan Industrial Co., Ltd |

**Why now.** The quote form stopped accepting free text in the factory box in the
same push — it is a closed select over the factory companies, carrying the same
structural rule `HtsField` does, so a stored name matching no company still
*displays* and nothing is erased. But 52 quotes the app could not resolve to a
company is 52 quotes where the select can only show text. All three were
spellings, not unknown firms.

**Spelling only, never a merge.** Every target already existed as a `factory`
company, and the guard refuses unless all three do. The only column written is
`quotes.factory`.

### The branch that failed, and why it was wrong

`b4` asserted the distinct spelling count would go **9 → 6**. The rehearsal
returned **9 → 8**.

The `want` was written on the assumption that all three aliases fold into names
already in the set. Only one does. **Re-pointing an alias removes a distinct value
only when its target already carries quotes** — Baoquan's target had 2, so that
one merges; the Liaoning and Aung Crown targets had **0**, so those two are
*renames* into values the set did not previously hold. Nine, minus the single
merge, is eight.

The evidence was already in the script: branch `a1` measures the targets as
`0 / 2`. The assertion was written without deriving it from a figure the same
file was printing.

**What limited the damage.** `b4` is a reporting branch — nothing acts on it. Every
branch guarding real change passed first time: `b1` no alias survives, `b2` the
targets hold 44/7/3, `b3` **zero quotes whose factory matches no company**, `c1`
no quote added, removed or left factory-less, `c2` no company row touched. A wrong
`want` that fails loudly is the cheap version of this mistake; one that happens to
pass would have certified something nobody checked.

### Verified from outside

| | before | after |
|---|---|---|
| quotes matching **no** company | 52 | **0** |
| `Liaoning Kangping Plastic Industry Co., Ltd` | 0 | **44** |
| `Aung Crown` | 0 | **7** |
| `Shenzhen Baoquan Industrial Co., Ltd` | 2 | **3** |
| the three aliases | 52 | **0** |
| distinct spellings | 9 | **8** |
| quotes total / with factory text | 340 / 337 | 340 / 337 |
| factory companies | 8 | 8 |

**The alias fold in the Companies export stays.** `FACTORY_ALIASES` folds two of
these three when building the factory list. It costs nothing now that the data is
clean, and it is what catches the same spelling arriving again from an older quote
or an import.

---

## Script 72, as run — 2026-09-22, the quotes whose client the catalogue can name

`z0` on the first rehearsal, preflight passed first time. Sets
`quotes.client_company_id` on the **3** rows where it was null and the trimmed
lowercase client text matched exactly one company of type `client`. Rows matching
zero or several are left exactly as they were.

| quote | sku | client text | → |
|---|---|---|---|
| `a1913a2f…` | LLN-500 | Legoland New York | `1c4f5a5f…` Legoland New York |
| `ed5e4669…` | LLN-473 | Legoland New York | `1c4f5a5f…` Legoland New York |
| `3d1c731a…` | BUC-157 KU2607001-copy | Buc-ees | `14cf63ad…` Buc-ees |

**The same resolution `saveQuote` uses, deliberately.** That function matches the
free text case-insensitively and takes the answer only when there is exactly one
hit — zero and several both leave the column null, because either is a guess. This
script is that rule applied once to the rows that predate it. A backfill
resolving more loosely than the app would leave rows the app itself would never
have produced.

**Why the nulls existed.** `client_company_id` was backfilled by script 48 and
then nothing maintained it until the quote form began resolving on every save. A
quote saved before that, or never re-saved since its company was created, keeps a
null. The two Legoland New York rows are exactly that: they named a client the
catalogue had no company for at the time, and the company was created 2026-09-16.

**The ambiguous branch is written and empty.** No client company name is
duplicated case-insensitively today, so nothing matches several. The guard still
refuses if that changes, because the right answer then is to merge the companies,
not to have a script pick one.

### Verified from outside

| | before | after |
|---|---|---|
| quotes with no client company | 5 | **2** |
| linked by this script | — | **3**, each checked by id |
| resolving to zero / several | 2 / 0 | 2 / 0 |
| linked quotes pointing at a non-client or missing company | 0 | **0** (all 340 checked) |
| company rows touched | — | **none** |

### The twenty-fifth client company, and why the count moved

The script asserted **24** client companies and passed — there were 24 when it
ran. A later check read **25**.

`Broughton HS` was created by hand at **21:21 on 2026-09-22**
(`eeeba436-0419-467f-a058-512843bb23f6`), **after** this script ran. Nothing is
wrong with either number; they describe different moments.

**What it changes.** Quote `6398b185…` (BRO-001) still carries a null
`client_company_id`, but its text now matches exactly one company. It is no
longer unresolvable — it is **unsaved**. Opening and re-saving that quote links
it, because `saveQuote` resolves on every save. No second script is needed.

**What it would have changed.** Had the company been created *before* this ran,
the guard would have **refused** — `resolvable` would have been 4 and
`zero_match` 1, neither matching the measured 3 and 2. That is the intended
behaviour, and it is worth recording that the guard was never actually tested by
it.

So only **`Legal`** is now genuinely a client the catalogue cannot name, and that
one needs a person to say what it is rather than a script.

---

## Script 74, as run — 2026-09-23, products that only ever belonged to one client

`z0` after **two failed rehearsals**, both raising `21000 more than one row
returned by a subquery used as an expression`, and both from the same expression
for different reasons. Sets `products.client_company_id` on the **72** rows where
it was null and every quote on that product resolved to the same single client
company. Verified from outside afterwards with fresh queries rather than by
re-reading the branches of the script itself.

**Why the nulls existed.** `ensureProductForQuote` minted a product from a quote
and wrote `sku`, `name` and `origin` — nothing else. The client was known at that
moment and thrown away. The code shipping alongside this script passes it on the
insert, so this is that rule applied once to the rows that predate it.

### The two rehearsals, and why the first fix was the wrong fix

**Rehearsal one** failed. The diagnosis offered was that `count(distinct x)`
ignores nulls while `select distinct x` does not — so a product with one real
client plus a quote resolving to nobody would pass `count(distinct) = 1` and then
return two rows, one of them null. That is **a real defect** and the null filters
went in.

**Rehearsal two failed identically**, which is the instructive part. The null trap
is **latent, not live** — there are **0** products in that state today, so
filtering nulls could not have changed the outcome.

The actual cause is different: **a condition sitting beside a scalar subquery in
the same `AND` chain does not guard it.** Postgres may evaluate the parts of a
`WHERE` clause in any order, so `count(distinct …) = 1` does not run first merely
because it is written first.

| site | position | survived? |
|---|---|---|
| archive `client_company_id_after` | target list | yes |
| `UPDATE … SET` | set clause | yes |
| `already_disagreeing` | **where clause** | **no** |
| `b6` | **where clause** | **no** |

A target list and a `SET` clause are evaluated only for rows that already
qualified; a `WHERE` clause is not ordered at all. All four sites now use
`max(x::text)::uuid`, which returns exactly one row whatever the data does — one
value, or null when nothing matches — so no site depends on that distinction.

**Found by measuring, not by reasoning.** Two rounds of reading the SQL produced a
confident and wrong answer. Running each statement's read-only parts in isolation
settled it in one pass: the archive returned 72 rows, `already_disagreeing` raised
on its own, and a grouped query named the offending product immediately.

### `LLF-1617` — the row that raised it twice

`0ea36842…` **VIP Drawstring Bag Black**, two quotes naming two different
companies: **Legoland** and **Legoland Florida**.

It already carries a client, so the backfill never considered it and no branch
counts it. But two names that close together read like one client recorded twice —
the same shape as the `UPM` merge in script 68 — and a product quoted to both is
worth knowing about either way. **Open question for a person.**

### Verified from outside

| | before | after |
|---|---|---|
| products | 358 | **358** |
| carrying no client | 84 | **12** |
| linked by this script | — | **72** |
| of the 12 left — no quote at all | 11 | **11** |
| of the 12 left — every quote unresolved | 1 | **1** |
| still linkable by this rule | 72 | **0** |
| already disagreeing with their own quotes | 12 | **12**, untouched |
| linked products pointing at a non-client or missing company | 0 | **0** (all 346) |
| quotes with no client company | 1 | **1**, untouched |

**Nothing was overwritten.** The only column written is
`products.client_company_id`, and only where it was null. The **12** products
carrying a client their own quotes disagree with are still there and still
disagreeing — a separate question, and not this script to answer.

---

## Script 73, as run — DELETE on `programs`

`authenticated` gained DELETE on `vessl.programs`; `anon` and PUBLIC were revoked
first and `anon` still holds none. Measured afterwards: relacl
`{postgres=arwdDxtm/postgres,authenticated=arwd/postgres}`.

**It was run before `program_tasks` existed**, so its header describes a world
that has since moved: it names `program_notes` as the only table cascading from
`programs`, and its `b5` checks that one key alone. Script 76 then created
`program_tasks` with `program_id` **on delete cascade** too, so a delete now takes
the card, its notes **and its checklist** — measured, both keys `confdeltype = c`.
The script is committed as written, not edited to match.

The header's open question — whether the missing DELETE was a deliberate revoke —
was answered by use: the card gained *Delete card* in `4e0031d`, behind a typed
`DELETE` confirm, beside the reversible *Remove from board*.

---

## Scripts 75, 76 and 77, as run — 2026-09-23, the PLM rebuild groundwork

One `z0` each, preflight passed first time on all three, and all three verified
from outside afterwards with fresh queries rather than by re-reading their own
branches. Together they are everything the database needs before the board is
rebuilt on Riley's 11 Aug design.

### 75 — the six-stage ladder

`quoted` → `sampling` → `revision` → `testing` → `production` → `shipped`, with
NULL still allowed because a card with no stage set is a real state the board
draws a column for. `purchase_order` migrates to `production`, `complete` to
`shipped`. **`quoted` keeps its stored value and is merely labelled Quoting on
screen** — the same trade `COMPLETE_LABEL` already made, and renaming it would
have meant migrating every row and every reader for a word.

**Zero rows moved**, measured rather than hoped: 2 on `quoted`, 1 on `sampling`,
none on either retired value. The UPDATE and its guards are still written,
because the board is in use and that could be false by the time it ran.

**The trigger was the trap.** `trg_programs_declared_stage_at` fires on
`UPDATE OF declared_stage`. A migration writing that column would have
**restamped `declared_stage_at`** — turning a card that had sat in Purchase Order
for forty days into one that entered Production this morning, and resetting the
days-in-stage the whole board is read by. With no rows to move, that damage would
have been completely invisible today and would have landed the next time anyone
reran the shape. The trigger is disabled around the UPDATE and re-enabled after;
`b5` asserts the stamp did not move and `b6` asserts the trigger is armed again,
because a disabled trigger left behind would silently stop stamping every future
stage move.

### 76 — `vessl.program_tasks`

The per-stage checklist, recreated on today's model: `owner_id` is a
`staff_profiles` key rather than Riley's email string, `assigned_by` stays an
address because an audit crumb has to survive somebody leaving, and `program_id`
cascades exactly as `program_notes` does.

**The schema default privileges are the dangerous part.** `pg_default_acl` for
relations in `vessl` reads `{authenticated=arwdDxtm/postgres}`, so a table created
the obvious way arrives with INSERT, SELECT, UPDATE, DELETE, **TRUNCATE**,
REFERENCES and TRIGGER already granted. Everything is revoked first and four
privileges granted back. Same lesson as scripts 21 and 34, in its table form.

**No author policy, deliberately.** `program_notes` carries two RESTRICTIVE
policies confining edits and deletes to the person who wrote the row, because a
note is somebody's words. A task is shared work — the point of a checklist is
that anybody can tick an item off — so the only rule is the staff gate.

### 77 — the sample strip on the card

`sample_round`, `master_sample_included`, `sample_sent_date`, `sample_due_back`.
All nullable, none defaulted: a card that has never been sampled should say
nothing rather than claim round 1 on the day it was created.

**On the program, not the product**, and that is the whole decision. The sampling
*log* lives in `product_notes` and is shared by every card for a SKU, because a
round that happened happened once whoever it was for. These four describe the
round *in flight for one client* — two clients sampling the same product are on
different rounds with different dates. On the product they would overwrite each
other, which is the fault script 67 already fixed once.

**No grant block, and that is asserted rather than assumed.** `authenticated`
holds table-level UPDATE on `programs`, and a table-level privilege covers columns
added afterwards; `b4` checks `has_column_privilege` on all four rather than
trusting it.

### Verified from outside

| | before | after |
|---|---|---|
| declared_stage CHECK | 5 values + NULL | **6 values + NULL**, no `purchase_order`, no `complete` |
| rows on the retired values | 0 | **0** |
| stage distribution | quoted 2, sampling 1 | **unchanged** |
| `trg_programs_declared_stage_at` | enabled | **enabled**, stamps unmoved (`420bfbfd` still 2026-09-18 21:52) |
| `program_tasks` | absent | **present**, 0 rows |
| its ACL | — | **`authenticated=arwd`**, TRUNCATE false, anon false×4 |
| its RLS | — | **on**, one permissive `staff_only` on `is_staff()` both sides |
| its keys | — | `program_id` cascade `c`, `owner_id` no-action `a` |
| sample columns | 0 of 4 | **4 of 4**, all nullable, all undefaulted |
| `programs` ACL | `arw` | **`arw`**, unchanged |
| `programs` columns | 14 | **18** |

---

## The PLM rebuild, as built — 2026-09-23

Riley's 11 Aug board and card on today's data model, in four staged commits,
each passed on localhost before the next began. PLM.md's top box is the current
description; this is the record of how it got there and what was decided on
the way.

| Stage | Commit | What |
|---|---|---|
| 1 | `cfdadb4` | Six-stage ladder, 272px columns, drag removed, Removed column behind a toggle, owner chips from `staff_profiles` |
| 2 | `fb6db4d` | Card tabs: **Sampling** (pills, Advance, owner, sample strip, quick emails, notes, Remove) and **Card** (system knows, sampling log, exports) |
| 3 | `35eba46` | `program_tasks` checklist, seeded once per stage; blocker pills and the three waiting tiles |
| 4 | `ea7001c` | A saved PO moves its cards to Production; seeding shared in `lib/programs.js`; Create PLM Card owner = quote creator |

Stage 5 was the deletions, and there were none to make: *New Program*, the
factory sheet and import, and Riley's inline notes block were never ported.

### Decisions taken in the build, not in the plan

- **The "to Emily" emails go to the factory.** No Emily is on staff; Emily Chen
  (`emily@xxwy.cn`) is the Fuzhou factory contact, so Riley's hardcoded
  `emily@kinguniversal.com` was a factory email all along.
- **Pre-Production's tasks fold into Production**, minus "PO issued" — a PO is
  what puts a card there now.
- **Pills seed the checklist, not only Advance.** 11 Aug seeded on Advance only,
  which left a card moved by a pill with no list.
- **The PO rule counts new lines only on an edited PO.** Re-saving an old PO must
  not pull back a card somebody moved off Production by hand. A changed product
  or client on an existing line moves nothing either.
- **A task delete asks first.** 11 Aug did not; the × sits beside the blocker.

### Two faults found and fixed on the way

**The board reload unmounted the open card.** `load()` set `loading` true on every
call, and the page returns a placeholder while loading — so every stage move,
note or sample swapped the whole page out and remounted the card: tab reset,
half-typed text elsewhere on the card lost. Only the first load shows the
placeholder now.

**`useDirtyGuard` counted every change as unsaved.** Its snapshot already skipped
`data-noguard` controls and nested modals, but its `change` listener did not — so
any self-saving control, and any typing inside a nested modal, marked the outer
card dirty. The remount above had been hiding it. Both listeners now apply the
same two exclusions. **This is app-wide**: search boxes inside modals no longer
make a close ask for confirmation, which is what their `data-noguard` said they
wanted.

### What is open

- Two stale thresholds: health 14 days, the pill 21. Unifying them is a decision.
- `ensurePrograms` in `lib/programs.js` has no callers left.
- The card exports carry neither the checklist nor the sample strip.

---

## Script 59, as run — 2026-09-16, nine parents from a sheet

`z0` on the second rehearsal, and verified from a fresh query afterwards. What the
first rehearsal caught is recorded at the end of this section.

**Where it came from.** The Products page export, edited by hand in Excel and handed
back as nine parent rows. The sheet is committed beside the data it produced —
`archive/2026-09-16-parent-products-upload.xlsx`, byte for byte as received, with
`archive/2026-09-16-parent-products-client-upload.json` holding the nine rows as they
stood before anything was written.

**Only two of its thirteen columns are product fields.** Client became
`client_company_id` and Catalogue status became `active`. **Factory, Country, Tiers,
Min price, Max price, Avg margin and Quote date all live on the QUOTE**, and Order
state is derived from order lines — none of them has a column on `products` to write
to, so all seven were ignored and the script says so at the top. Worth remembering
the next time an export comes back edited — a column being in the file does not make
it a field.

**What it did.**

- **Nine rows gained a client**, every one of them NULL beforehand, so nothing was
  overwritten. Five companies, matched by id with the length of the name as a second
  key: BucketGolf, Madame Tussauds, Paw Patrol, Legoland, Peppa Pig.
- **BG-104 and BG-113 went active.** BG-101 was already `true` and got no write.
- **LL1-1591 went the other way** — `false` to NULL, not recorded — **and was renamed**
  from *Ollie small water bottle* to *Ollie Water Bottle*.

**PEP-114 arrived with `1` in its client column**, which matches no company and is not
an id. It was held out of the first draft entirely rather than guessed at, and went in
only once a person said the client was Peppa Pig. A sheet is a person typing, and the
cell that makes no sense is the one worth stopping on.

**The rename had to be proved safe first.** `products_sku_name_key` is UNIQUE over
`(sku, name)` and **three rows carry SKU LL1-1591** — the other two are *Olivia small
water bottle* and *Youth steel water bottle*, both inactive, both untouched. The guard
re-proved the new name was free on that SKU rather than trusting the measurement, so a
collision could not become a failed transaction half way through.

### Verified from outside

| | before | after |
|---|---|---|
| the nine parents with a client | 0 / 9 | **9 / 9** |
| BG-104 / BG-113 | NULL / NULL | **true / true** |
| LL1-1591 `2edeaee1` | false, *Ollie small water bottle* | **NULL, _Ollie Water Bottle_** |
| its two siblings | false, 25 and 24 characters | unchanged |
| quotes / PO lines / programs | 332 / 256 / 312 | unchanged |

**What the rehearsal taught.** `b5` asserted `length(name) = 24` for **both** siblings,
and *Olivia small water bottle* is 25. The check failed, the transaction rolled back
clean, and the script was wrong rather than the data. Two rows are two identities: each
one now gets its own id and its own length. The rule this belongs to is the one already
written down — identity is an id plus something measured about that row, never a shape
assumed to be shared.

**And a preflight trap worth knowing.** The verification block is found as everything
from the first `select * from (` in the file, so a temp table written as
`select * from (values …)` is parsed as branches — which is what the uncast-`got`
failure on the first run was really saying. Name the columns.

---

## Script 57, as run — 2026-09-15, sold products brought into service

`z0` on commit, and verified from a fresh query afterwards.

**Why.** Script 52 reconciled `products.active` against purchase order lines alone,
so a product the client had bought through a sales order but that KUI had never
raised a PO for went to NULL. Since `a74c8fc`, PLM calls a product ordered once it
has a purchase order line **or** a sales order line. 57 brings the catalogue flag
onto that one definition, and `16a086d` does the same for the Products list.

**What moved.** 36 products with at least one sales order line and `active` NULL
went to `true`, `updated_at` stamped. 28 of them were products script 52 had set
to NULL the day before; the other 8 (LHS-188 to 190, LL1-1212 to 1214, LLW-1544
and 1545) also have purchase order lines, were last updated 2026-08-06, and were
already NULL, which 52 left alone because it moved only rows that were `false`. Most of the rest are BucketGolf, plus
JUAC100460. Retired rows were not touched, and nothing already `true` changed.

**What was held.** BUC-138 is the 37th. Its only sales order is on ZZTESTER, the
test client, and a test order is no reason to put a product in service, so it
stays NULL. The script names that client by id plus the length of its name, never
by the name alone, and its guard refused to run unless the counts were exactly
36 to flip and 1 held.

**Not in scope.** 11 LHS parents — LHS-152 and LHS-170 to LHS-187 — have purchase
order lines only and are still NULL. They belong to script B and the sizes
question, not here. Counting them is what made the estimate ~49; the real
PO-or-SO figure was 48.

**Proven by the checks.** `active` went true +36, NULL −36, `false` unchanged. A
fingerprint of `active` and `updated_at` on every other product, and of
`updated_at` on every retired row, was unchanged. No product sold to a real
client is left NULL. Row counts didn't move.

**Archive.** `archive/2026-09-15-product-active-sales-orders.json` holds all 37 rows
as they stood, with their sales order lines, exported before the script was
written, and checked equal to that export.

**The Products list.** The *Ordered* state counts sales order lines as well as
purchase order lines (`16a086d`). *Last ordered*, *Orders* and the order-dates
note still count purchase orders only, because they are about POs.

| | before | after |
|---|---|---|
| `active` — true / false / NULL | 65 / 137 / 150 | **101 / 137 / 114** |
| BUC-138 `active` | NULL | NULL |
| products / quotes / PO lines / SO lines / programs | 352 / 332 / 256 / 258 / 312 | unchanged |
| Products list — ordered / not yet / never used | 86 / 227 / 39 | **192 / 121 / 39** |

---

## `production_pct` — a column the board wrote for ten weeks, 2026-07-08 to 2026-09-15

`8f63202` (2026-07-08) gave the Production Board a percentage: `PO_CARD_SELECT`
read `production_pct`, and `setPct` wrote it on every ±10 nudge. **No such column
existed** — measured on 2026-09-14, no table in any schema carried the name.

Two consequences, both silent:

- **The purchase order list ran on its fallback query the whole time.** PostgREST
  rejected the primary select with 42703 on every load, and a catch quietly
  retried a reduced select that also dropped `client_po_number`, so PO cards showed
  internal order numbers where client PO numbers belong (measured 2026-09-14: 12
  of 68 POs carry one, and 2 differ from the order number). Found on 2026-09-14
  from two 400s in the browser console while checking the CRD change on the PO
  grid — not from any error anybody had seen.
- **The percentage never saved.** Every nudge returned 400, and every card read
  `Number(undefined) || 0`.

`596794e` (2026-09-14) took the column out of the primary select and made the
fallback log the PostgREST message and raise a toast: **a fallback that hides the
failure it exists to survive is how this lasted ten weeks.** Riley and Steven
confirmed they use the percentage, so script 53 added the column instead of the
control being removed, and `5489968` put it back in the select. The fallback still
leaves `production_pct` out on purpose — the newest column is the likeliest one a
stale schema cache is missing.

---

## Plain dates rendered a day early — `fmt` and `daysSince`, fixed in `a74c8fc`

`lib/lifecycle.js`'s `fmt` passed a plain `YYYY-MM-DD` to `new Date()`, which is
**midnight UTC** — the evening before anywhere in the US. Every quote date, PO and
SO order date and test date on PLM and on the Testing lifecycle panel rendered
**one day early**: `2026-07-21` read *Jul 20, 2026* in New York. Found while
checking the new *Ordered for* label on LLF-1617.

`daysSince` had the same trap: the card's days-in-stage read one day high from 8pm
Eastern — a quote dated today read 1d at 9:30pm.

Both now treat a plain date as a local calendar day. `fmt` builds the date from its
parts; `daysSince` counts whole days between local midnights, rounded so a 23- or
25-hour daylight-saving day still counts as one. Timestamps are unchanged. Proven
with a faked clock at 9:30pm Eastern and across both 2026 DST changes.

**Audited, not changed.** Every other formatter already reads a plain date at local
noon: `fmtDate`, `fmtDateShort` and both local `fd` helpers in `page.jsx`,
`fmtDate` in `pricing.jsx` and `testing.jsx`, `CreateProductModal`'s `fmtDay`, and
`excelDate` in `lib/excel.js`. `fmtDateTime`, `timeAgo`, `etaDays`, `quotes.jsx`'s
`fmtStamp` and PLM's note times only ever receive timestamps.

**Still open — UTC "today".** These take `new Date().toISOString()` as today and
fill in **tomorrow** after 8pm Eastern: `nd()` (Create SO default), `nowDate()`
(Create PO default), the `quote_date` fallbacks in `page.jsx` near lines 3867 and
6647, and the new-quote default in `quotes.jsx` near line 1088 (line numbers as of
`a74c8fc`). `monthStart` is correct in US time zones.

---

## PLM completion becomes product-level — 2026-09-15, `a74c8fc`

Until now a program left the pipeline only when **its own client** ordered or sold
it. That missed orders placed under a sibling company record: `LLF-1617` sat in the
pipeline for *Legoland* while *Legoland Florida* had ordered it (PO 2026-07-21) and
been sold it (SO 2026-07-22).

**The rule now:** a program also leaves when its **product** has any linked PO line
or SO line, for any client. The archived row and the card's final step name it —
*Ordered for Legoland Florida · Jul 21, 2026* or *Sold to <client> · <date>* — by
whichever came first on the calendar, a PO winning a same-day tie. An order under
the program's own client still wins outright, because it is that program's own
event.

| | before | after `a74c8fc` |
|---|---|---|
| pipeline | 91 | 89 |
| archived (was *Completed*) | 192 | 194 |
| Quoted / Sampling / Tested | 6 / 83 / 2 | 6 / 82 / 1 |
| retired toggle | 52 | 52, then 29 after script 56 |

- **BUC-138's only sale is a ZZTESTER test order.** It stays archived until that
  test data goes; then the board reads 90 / 193.
- **Sales count, deliberately.** A PO-only rule — matching the Products list exactly
  — read 90 / 193. Counting SO lines too means a product already sold to anyone is
  not shown as new work.
- **A SKU-level rule was measured and dropped:** 0 of the 90 moved, exact or
  case-insensitive. The `-EXW` / `-Landed` / `-INT` / `-USA` variants are different
  SKU strings, so no SKU rule can reach them.
- **Nine BucketGolf programs may be in the pipeline wrongly:** BG03-Landed,
  BG03RL-Landed, BG06-Landed, BG06RL-Landed, BG06RRRL-Landed, BG06RRRR-Landed,
  BG09-Landed, BGBALLS-Landed and BGRHTC-EXW. Their names appear on unlinked PO
  lines on BucketGolf's own POs — the 85-line backlog above, not this rule.
- *Completed* is *Archived* everywhere it shows; the toggle reads *Include N
  retired, never ordered*.

---

## Same-SKU twins merged — 2026-09-15, script 56, and the size rows that wait

**The inflation check.** Of the 246 programs off the board (194 archived, 52
retired), **91** sat on a retired product row with a more-live twin:

| match | programs | what they are |
|---|---|---|
| same SKU | 25 | BG-101 / 104 / 113 size twins (18), JON-106, LL1-1591 ×2, LL1-1629 ×2, LL1-380 Small and Medium |
| base SKU plus a suffix | 66 | Leesville `LHS-### - Size` rows (59), `JON-106-copy`, and 6 whose parent has no program for that client |

Two more rules were run and **thrown out**. A letter-prefix rule matched any two
BucketGolf SKUs ending the same way (`BGBALLS-EXW` with `BGLHAC-EXW` — 17 false
positives), and a same-name rule found only costing and market siblings (20). A
renamed row leaves nothing to find: `audit_log` has 0 rows and `rename_product_sku`
renames in place. A further 77 programs match only an equally-live twin and were
not touched.

Checked **record by record**, not by kind of evidence: 6 are the same records
counted twice, 20 carry a separate, differently-dated quote, and **65 hold evidence
that exists only on the old row** — 65 quotes and 57 SO lines.

**Merge, not suppress.** Suppressing would have hidden the old rows without touching
data, but it leaves `LHS-183` in the pipeline although its size rows were sold, and
it hides the only record of those sales.

**Script 56 is merge A — same SKU, LL1-380 excluded.** Each of 23 retired rows held
exactly one quote and nothing else; the quote was re-linked to its survivor and the
empty program deleted. The old product rows remain, retired and empty.
`quotes.updated_at` was left alone, so 23 old quotes do not read as edited today.
Everything touched is in `archive/2026-09-15-plm-same-sku-twins-merge.json`
(`e19041d`), checked equal to the database export and to the script's 23 id tuples
before it ran. Programs 335 → 312; board 89 / 194 / 52 → **89 / 194 / 29**.

**Script B waits on Kristy's sizes answer:** the 66 base-plus-suffix rows and the two
LL1-380 rows, which carry PO lines. Measured before 56, doing A and B together moved
the board to 92 / 136 / 20 — `LHS-183` to archived, and four parents (LLF-1605,
LL1-1616, SL-117, LL1-1621) into the pipeline as quoted, never-ordered work.

---

## Scripts 50 and 51, as run — 2026-09-11

Both `z0` on rehearsal and commit, `51-after-commit-checks` `z0` and rolled back
as designed.

### 50 — the Koozie, and the last SKU-less product

Product `78dffbc0`, *Koozie with magnet*, had carried `sku` NULL since it was
created — the last open item from the 8 September duplicate census.

**Kristy had already done half of it.** She set the quote's SKU to `STC-016` on
Thursday at 15:55, the save landed, and the follow-on rename died against a table
script 48 had renamed eight minutes earlier (see below). So 50 wrote **one
column**, and `b3` asserted the quote still read what she typed rather than
touching it.

Verified from outside afterwards: the product reads `STC-016`, exactly one row in
the catalogue holds it, the one quote is hers, zero PO lines and zero SO lines
carry it — **and `products` now has 0 rows with a NULL sku.**

### 51 — `rename_product_sku` had been broken for a day

**Every SKU rename failed**, whatever SKU it started from. The function read
`programs.sku` and `programs.quote_sku` in three statements and script 48 had
replaced that table with one carrying neither column. plpgsql plans a statement
when it first *executes*, and all three executed even with an empty
`p_program_ids` — an empty `unnest` yields no rows, but the planner still has to
resolve the columns.

It landed at **Apply**, not at open: step 1 had removed the modal's client-side
`programs` query, so the checklist loaded perfectly and the failure arrived after
somebody had ticked their boxes. Nobody had renamed a SKU since 48, which is the
only reason it went unnoticed.

**`p_program_ids` stays in the signature, ignored.**
`RenameSkuModal.jsx:116` is the only call site in the repo — grepped, and the
only other RPC anywhere in the app is `rfq_digest_rows`. PostgREST resolves a
function by *argument names*, so dropping the parameter would break that call
outright, and keeping both signatures would make it ambiguous. It is vestigial,
and it should be dropped **together with the client**, never one alone.

**The grant was tightened while the function was open.** `EXECUTE` had been held
by `PUBLIC` since it was created, and `anon` inherits `PUBLIC` — the same default
script 21 found on the digest function. Smaller exposure here, since this
function is not `SECURITY DEFINER` and RLS still applied, but **`CREATE OR
REPLACE` preserves grants**, so the default would have survived the repair
untouched. Now `anon` false, `authenticated` true, `PUBLIC` none.

**The proof is a rename that actually happened.** 51's own checks are a text
search over the definition, which cannot tell you the function still works.
`51-after-commit-checks` creates a throwaway product, renames it **through the
RPC** rather than by a raw UPDATE that would pass either way, then checks what
the function *reported* and what the table *holds* as two separate things — a
report claiming a change nobody made is the failure that pair exists to catch.
The row is deleted explicitly **and** the transaction rolls back.

### Two checks that were wrong while the repair was right

Worth recording because both failed a correct script, which is the expensive kind
of wrong:

**`b1` read its own explanation.** It asserted the repaired function no longer
mentions the programs table by searching `pg_get_functiondef` — and
`pg_get_functiondef` returns comments along with code, so the tombstone comment
saying what had been removed satisfied the search. The near miss is worse than it
looks: the qualified name is a **prefix of the legacy table name**, so a comment
politely referring to the renamed table would have tripped it too.

**`b4` wanted types where the catalogue renders names.**
`pg_get_function_identity_arguments` returns `p_product_id uuid, …`, not
`uuid, …`.

**`b7` was added** to assert nothing `unnest`s `p_program_ids` — the signature
contains the parameter name, so searching for the name alone proves nothing about
whether it is read.

**preflight gained rule 9:** *no absence check its own body satisfies*. It finds
every `position('X' in pg_get_…def(…)) = 0` and fails if `X` also appears inside
a dollar-quoted body in the same file. **Polarity is the whole point** — a check
asserting a string is *present* normally wants it in the body, and 51 has three
of those; only the `= 0` form can be defeated this way. Verified against both the
original bug and the `programs_legacy` near miss.

Two earlier rules were earned the same day, both by narrowing checks that were
too broad rather than by bending scripts to satisfy them: `:=` is exempt from the
colon rule, and that rule now flags `:identifier` rather than any colon at all —
51's plpgsql body is full of error messages that read like English.

---

## A schema rename broke a colleague's tab — 2026-09-10, 15:55

Kristy reported *"column does not exist"* saving a quote edit on Thursday
afternoon. Reconstructed from timestamps, and **the two things she reported this
morning turned out to be the same event.**

### The timeline, to the minute

| time (ET) | what |
|---|---|
| **15:36:53** | `c7ecbe2` pushed — step 1, which removes every read of the old `programs` columns |
| **15:37:25** | that deploy READY |
| **15:47:00** | **script 48 commits** — `programs` renamed to `programs_legacy`, a new table in its place |
| **15:55:57** | Kristy saves the Koozie quote, setting its SKU to `STC-016`. `updated_by` is her address |
| ~16:03 | she reports the error |

**Her tab was loaded before 15:37 and never refreshed**, so it was running the
pre-step-1 bundle — which still asked `programs` for `sku`, `quote_sku`, `product`
and `stage`. Script 48 had replaced that table eight minutes earlier, and the new
one has none of those columns.

**The fix was already deployed 18 minutes before she hit the bug.** Shipping the
code first is what made the window 18 minutes instead of open-ended — but a
deploy does nothing for a tab that is already open.

### Her edit did save

`quotes.sku` reads `STC-016`. The quote UPDATE succeeded; what failed was the
SKU-propagation step *after* it — a SKU change opens `RenameSkuModal`, whose
preflight queried `programs.sku`. She saw an error and reasonably assumed nothing
had been saved.

**The product still has `sku` NULL**, because the rename died before touching it.
Script 50 finishes the job she started.

### The rule this earns

**A schema rename needs a "refresh your browser" heads-up to anyone working.**
Three deploy-ordering steps were planned and followed precisely so the code would
never write to a shape that no longer existed — and it still broke, because the
plan accounted for *deployed code* and not for *running code*. A browser tab is a
deployment nobody tracks.

For the next rename: post in the channel before running the script, not after.
The window is however long somebody's tab has been open, which on this team is
routinely hours.

### And a live bug it uncovered: `rename_product_sku` is broken

Not Kristy's error — a second one, found while checking whether the modal could
give the Koozie its SKU.

**The function still reads `vessl.programs.sku` and `vessl.programs.quote_sku`**
in three statements: the program-ownership guard and the two final `return query`
blocks. Script 48 dropped both columns. Verified directly —
`select 1 from vessl.programs x where x.sku = 'probe'` returns **42703, column
x.sku does not exist**.

plpgsql plans a statement when it first executes, and those statements execute
even with an empty `p_program_ids` array, so **every SKU rename now fails**,
whatever SKU it starts from. Nobody has renamed one since 48, which is why it has
gone unnoticed.

Step 1 removed the modal's *client-side* `programs` query, so its preflight loads
fine and the failure lands at Apply — after the person has ticked their
checklist. **Needs its own script to strip the three program references**; the
whole `p_program_ids` parameter has nothing left to address.

---

## Script 47, as run — 2026-09-10, the last line a script can link

`z0` on rehearsal and commit. One line: `f873c442`, `Blue Bottle Bubble Bath`,
qty 45,000 on purchase order `1302600279256` (`in_production`) → **`LLW-1545`**.

Verified after: **170 linked, 84 unlinked**, Ordered coverage **53 → 54** of 184,
the line reads `LLW-1545` and still prints **`(null)`** — snapshot blanked for the
third time, same reason as scripts 14 and 45. `b4` covered the second line on that
same purchase order; the stamped total across the table is unchanged at 94.

**It applied pass 1's rule rather than hand-picking a pair.** `a2` asserted
exactly one product in the catalogue carries that name and `a3` asserted it is the
selectable `LLW-1545` — without those, it would only have been an assertion that a
pairing looked right.

### The linking work is finished

**84 lines remain and no script can reduce that number.** They are the three
groups below, and every one of them needs a decision rather than a rule:

| group | lines | why a script cannot |
|---|---|---|
| BucketGolf configuration variants | 70 | several *selectable* products share each name |
| retired-only matches | 8 | two retired rows each, no survivor to pick |
| size rows on PO 51426 | 6 | live parents carry different product names |

The arc, for the record — **94 of 254 linked** when script 14 was measured (the
figure in the §6 board above), **170 now**, across scripts 14 (+4), 45 (+71) and
47 (+1).

And the number that matters more: **stamped `product_sku` was 94 then and is 94
now.** Seventy-six purchase order lines gained a product without one character
changing on any already issued document. That is the invariant those three
scripts were built around, and it held across all of them.

---

## The 85 purchase order lines script 45 will not link — questions for Kristy

Written 2026-09-10 alongside script 45, which links 71 of 156. These are the
other 85, in three groups, none of which a text rule can settle.

### 70 ambiguous — BucketGolf configuration variants

**17 distinct descriptions.** Several *selectable* products carry each name, so
there is no survivor to pick the way script 45 pass 2 picks one.

| description | lines | selectable matches |
|---|---|---|
| `tee box` | 9 | **9** |
| `6 hole set (2 right clubs)` | 8 | 2 |
| `9 hole set (2 right clubs)` | 7 | 2 |
| `9 hole set (4 right clubs)` | 6 | 2 |
| `6 hole set (no clubs)` | 5 | 2 |
| `9 hole set (no clubs)` | 5 | 2 |
| `toddler right-handed club` | 4 | 2 |
| `3 hole set (2 right clubs)` | 4 | 2 |
| `6 hole set (3 right, 1 left club)` | 4 | 2 |
| `9 hole set (3 right, 1 left club)` | 4 | 2 |
| `junior left-handed club` | 3 | 2 |
| `6 hole set (1 right, 1 left club)` | 2 | 2 |
| `bundle box` | 2 | 2 |
| `set of 6 balls` | 2 | 2 |
| `3 hole set (no clubs)` | 2 | 2 |
| `3 hole set (1 right, 1 left club)` | 2 | 2 |
| `6 hole set (4 right clubs)` | 1 | 2 |

**`tee box` matches nine selectable products on its own.** These read as
configuration variants of one product family sold as separate catalogue rows —
the same question the BG09RL costing bases raised, and Kristy has already decided
*that* one in favour of separate products. **The question here is narrower: which
row did each PO line mean?** No text rule answers it, and guessing puts a
factory purchase order against the wrong product.

### 8 that match only retired products

Two retired rows each, so pass 2 has no single survivor to choose.

`bg06rr` · `junior left handed club` · `junior right handed club` ·
`set of 6 fusion balls` — 2 lines each.

Note `junior left handed club` here versus `junior left-handed club` above: **the
hyphen is the only difference**, and it decides whether a line lands in the
ambiguous group or this one. That is worth Kristy seeing, because it says these
are the same product entered twice under two spellings.

### 7 that match no product *name* — and only one is really missing

All three descriptions sit on **in_production** purchase orders. First written up
as "no product exists"; **that was wrong for all three**, and the three are not
even the same problem as each other. Corrected 2026-09-10 after Matt identified
`Blue Bottle Bubble Bath` as `LLW-1545`.

| description | lines | what actually exists | shape |
|---|---|---|---|
| `Blue Bottle Bubble Bath` | 1 | **`LLW-1545`, selectable** — named `LLW-1545␣␣␣␣␣Blue Bottle Bubble Bath` | **naming** — script 46 |
| `Mock Neck "Parke" Ville, White` | 5 | five **retired** `LHS-183 - <size>` rows carry the name behind a prefix; live parent `LHS-183` is named *Mock neck fleece* | size rows |
| `White Aviator Nation Applique Tee` | 1 | one **retired** row `LHS-152 - Small`; live parent `LHS-152` is named *Aviator Nation Crew, White* and already holds 3 linked lines | size rows |

**The naming case is a real pattern, not a one-off.** 31 products have a `name`
that begins with their own `sku` — 11 selectable, 20 retired. A product named
`LLW-1545␣␣␣␣␣Blue Bottle Bubble Bath` is not named `Blue Bottle Bubble Bath`, so
it matches nothing and *looks* missing while sitting in the catalogue. Script 46
strips the prefix from the 11 selectable ones. It unlocks **exactly one** PO line;
the other ten are included because one latent fault with eleven instances should
not be fixed one visible instance at a time.

**The other six are the size-row question, and a name cleanup does not help
them** — proven, not assumed. Even after stripping prefixes, `Mock Neck` matches
five *retired* rows (ambiguous-retired, which script 45 leaves alone by design)
and `Aviator Tee` matches one *retired* row (still not a selectable match). In
both cases the **live parent carries a different product name**, so linking the
lines to it is a judgement about what the line meant, not a text fix.

**For Kristy, the question is:** did PO 51426 order the `LHS-183` mock neck and
the `LHS-152` aviator tee — in which case the live parents should absorb these
six lines — or are the retired size rows the real products and the parents
something else? Quantities on the five Mock Neck lines are 10, 2, 6, 15, 15 with
**no `size` value on any of them**, so the sizes cannot be recovered from the
lines themselves.

---

### Scripts 42 and 14, as run — 2026-09-10

Both `z0` on rehearsal and commit.

**42** moved PO line `3b753125` from `c8f3d2d2` to `ab86a997`, then retired
`c8f3d2d2` — the second product found unreachable from the Products page, after
the `BG09RL` orphan. It failed its first rehearsal outright:

```
ERROR 42804: UNION types text and vessl.order_status cannot be matched
```

`a3` read `purchase_orders.status`, which is an **enum**. Every branch of a
`UNION ALL` must agree on a type and `want` is always a text literal, so an
uncast `got` takes down the whole statement — no rows, no `z0`, no verification
at all, and nothing naming the branch but a line number. **preflight.py gained
rule 7 for it:** every `got` sub-select must carry `::text`, `string_agg` or a
`||`. The first version of that rule passed the very bug it was written for,
because it exempted any `got` containing a quote and that branch's WHERE holds a
`'…'::uuid`; caught by reintroducing the bug and checking the rule failed.

**14** linked the four costing-basis PO lines and then **nulled their
`product_sku` snapshots**, so `product_id` is set on all four and every issued
document prints exactly what it printed before. Three of those POs are
`in_production` and one is `shipped`; the stamp would have put `BGRHJC-Landed` or
`BGLHAC-EXW` in front of a factory, which is a costing basis, not a code they
have any use for. Verified after commit: 4 linked, 4 snapshots still NULL.

### The 32, and why they are one line rather than 32 badges

32 selectable products are declared `sample` and have already been ordered or
sold — **up from 3**, because Sold now counts as evidence of moving past sampling.
Thirty-two badges saying one sentence is noise, and noise is how a badge stops
being read. The Testing page states it once with a *Show them* toggle; the count
is live, so it shrinks as the stage gets maintained and disappears when it is.

**That number is also the evidence for Phase 2's Sample-to-Production proposal** —
nobody updates `product_stage` once an order lands.

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
