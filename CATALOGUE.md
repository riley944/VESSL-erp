# Products catalogue — session notes

Opening evidence for the catalogue-cleanup session. Everything below was measured
against the live database on **2026-08-28**. Re-measure before acting: see
"Number drift" at the end for why that is not optional.

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

- **`scratchpad/14-batch1-poi-product-id.sql`** — 4 rows, explicit UUID pairs,
  killian_untouched verification. Deferred: hygiene only, no visible defect, and
  it carries the 2518/2651 prerequisite.
- **`page.jsx:2518` / `2651` fallback fix** — ship independently, gates the above.
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
- **Product-change propagation** (Kristy's original ask) — see the Phase 1 analysis.
  Recommended shape was a prompt at product-save ("3 open orders reference this —
  update them?"), sequenced behind the 2518/2651 fix and the duplicate cleanup.
  Note `vessl.products` has **no price column** at all, so order prices are
  structurally immune to propagation; prices live on the order line and in
  `quotes.tiers`.

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
