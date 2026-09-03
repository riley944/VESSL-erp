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

---

## The scripts are the as-run record

`scratchpad/14` through `scratchpad/26` are the scripts as actually executed
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
