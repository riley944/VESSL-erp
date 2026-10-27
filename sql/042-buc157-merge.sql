-- 42 -- BUC-157 KU2607001, one product entered twice, resolved.
--
-- ── THE TWO ROWS ─────────────────────────────────────────────────────────────
--   c8f3d2d2  CO bag                                     not set  1 PO line, 0 quotes
--   ab86a997  CO Bag - Buc-ees Reusable Non-Woven Bag    true     0 PO lines, 1 quote
--
-- Kristy says the same product, entered twice. The evidence was SPLIT between them,
-- which is why neither looked wrong on its own -- the older row held the purchase
-- order line, the newer one held the quote and the better name. Section 0 of
-- CATALOGUE records the whole BUC-157 story; this closes the product half of it.
--
-- ab86a997 SURVIVES. It carries the full name, it is the row a person marked
-- Active, and it was created 2026-09-02 after the rename settled. c8f3d2d2 is
-- named CO bag, six characters, which is the abbreviation the rename was meant to
-- replace.
--
-- c8f3d2d2 IS THE SECOND PRODUCT FOUND INVISIBLE ON THE PRODUCTS PAGE, after the
-- BG09RL orphan script 38 retired. That page renders from QUOTES and this row has
-- none, so it has no row to click and no dropdown to change -- it cannot be
-- retired by hand any more than the last one could. See the section 6 board entry.
--
-- ── THE PO LINE, AND WHAT A FACTORY WOULD SEE ───────────────────────────────
-- Line 3b753125 on KUI-SO-2026-013, quantity 338000, description 40 characters --
-- the SAME LENGTH as ab86a997 name, because the line already describes the
-- surviving product. a3 asserts that rather than comparing the text.
--
-- THE PO IS A DRAFT, which is the only reason the stamp is safe. trg_poi_stamp_
-- product_sku fires BEFORE UPDATE OF product_id and rewrites product_sku, so on an
-- ISSUED document this would change what prints on a reprint. Here it does not --
-- the PO is unissued, and both products carry the identical sku string anyway, so
-- b4 asserts the stamped value is unchanged either way.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- Two rows for this sku. c8f3d2d2 holds 1 PO line and nothing else -- no quote, no
-- sales order line, no regulation link, no test report. ab86a997 holds 1 quote.
-- The target PO carries no other line pointing at ab86a997, so nothing collides --
-- and script 41 removed the constraint that would have cared. Rehearsal z0,
-- commit z0.

begin;

create temp table _pre42 on commit drop as
  select (select count(*) from vessl.products where active is distinct from false) as selectable_before,
         (select count(*) from vessl.products)                                     as products_before,
         (select count(*) from vessl.purchase_order_items)                         as poi_before;

create temp table _b42 on commit drop as
  select i.id, i.product_id, i.product_sku, i.description, length(i.description) as desc_len, i.quantity
    from vessl.purchase_order_items i
   where i.id = '3b753125-8e00-465b-b3c0-cbf2c9f1bbf6'::uuid;

-- 1. MOVE THE LINE FIRST, so the row being retired is already unreferenced when it
--    is retired. Guarded on it still pointing where it was measured.
update vessl.purchase_order_items i
   set product_id = 'ab86a997-7215-4461-9159-1f652430f8be'::uuid
 where i.id = '3b753125-8e00-465b-b3c0-cbf2c9f1bbf6'::uuid
   and i.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid;

-- 2. RETIRE THE DUPLICATE. Guarded on still-selectable and on its raw name length,
--    so a row somebody has renamed or retired since is skipped and fails loudly.
update vessl.products p
   set active = false
 where p.id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid
   and p.active is distinct from false
   and length(p.name) = 6;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the line was on the duplicate, at its exact description length' as chk,
         (select count(*)::text from _b42
           where product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid and desc_len = 40) as got,
         '1' as want
  union all
  select 'a1 the duplicate held nothing else at all',
         (select (
            (select count(*) from vessl.quotes q where q.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid) +
            (select count(*) from vessl.sales_order_items s where s.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid) +
            (select count(*) from vessl.product_regulations r where r.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid) +
            (select count(*) from vessl.product_materials m where m.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid) +
            (select count(*) from vessl.test_reports t where t.product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid)
          )::text), '0'
  union all
  -- THE EVIDENCE THIS IS ONE PRODUCT. The line already describes the survivor.
  select 'a2 the line description is the same length as the survivor name',
         (select (b.desc_len = length(p.name))::text from _b42 b, vessl.products p
           where p.id = 'ab86a997-7215-4461-9159-1f652430f8be'::uuid), 'true'
  union all
  -- purchase_orders.status is an ENUM (vessl.order_status), and every branch of
  -- this union has to agree on a type. Without the cast the whole statement fails
  -- to plan -- no rows, no z0, no verification at all.
  select 'a3 the purchase order is a draft, so nothing issued is restamped',
         (select po.status::text from vessl.purchase_orders po
            join vessl.purchase_order_items i on i.purchase_order_id = po.id
           where i.id = '3b753125-8e00-465b-b3c0-cbf2c9f1bbf6'::uuid), 'draft'
  union all
  select 'b1 the line now points at the survivor',
         (select count(*)::text from vessl.purchase_order_items
           where id = '3b753125-8e00-465b-b3c0-cbf2c9f1bbf6'::uuid
             and product_id = 'ab86a997-7215-4461-9159-1f652430f8be'::uuid), '1'
  union all
  select 'b2 the duplicate is retired',
         (select count(*)::text from vessl.products
           where id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid and active = false), '1'
  union all
  select 'b3 and nothing points at it any more',
         (select count(*)::text from vessl.purchase_order_items
           where product_id = 'c8f3d2d2-2b37-4ff2-9e04-f022adb31697'::uuid), '0'
  union all
  -- THE TRIGGER RAN AND CHANGED NOTHING, because both rows carry the same sku.
  select 'b4 the stamped product_sku is what it always was',
         (select coalesce(i.product_sku,'(null)')::text from vessl.purchase_order_items i
           where i.id = '3b753125-8e00-465b-b3c0-cbf2c9f1bbf6'::uuid), 'BUC-157 KU2607001'
  union all
  select 'b5 the description and quantity are untouched',
         (select (i.description is not distinct from b.description
                  and i.quantity is not distinct from b.quantity)::text
            from _b42 b join vessl.purchase_order_items i on i.id = b.id), 'true'
  union all
  select 'b6 the survivor is still selectable and now holds the line',
         (select p.active::text || '/' ||
                 (select count(*) from vessl.purchase_order_items i where i.product_id = p.id)::text || '/' ||
                 (select count(*) from vessl.quotes q where q.product_id = p.id)::text
            from vessl.products p where p.id = 'ab86a997-7215-4461-9159-1f652430f8be'::uuid), 'true/1/1'
  union all
  select 'c1 selectable products down by exactly one',
         (select ((select selectable_before from _pre42)
                - (select count(*) from vessl.products where active is distinct from false))::text), '1'
  union all
  select 'c2 no duplicate sku group remains for this sku',
         (select count(*)::text from vessl.products
           where sku = 'BUC-157 KU2607001' and active is distinct from false), '1'
  union all
  select 'c3 no product or purchase order line created or deleted',
         (select ((select count(*) from vessl.products) - (select products_before from _pre42))::text || '/' ||
                 ((select count(*) from vessl.purchase_order_items) - (select poi_before from _pre42))::text), '0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
