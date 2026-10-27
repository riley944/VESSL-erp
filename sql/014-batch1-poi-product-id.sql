-- 14 -- the four costing-basis purchase order lines, linked. FINALIZED.
--
-- Parked since 2026-08-31 on two blockers. BOTH ARE NOW CLEARED.
--
--   THE CONSTRAINT. UNIQUE (purchase_order_id, product_id) stopped 9 of the
--   original 13 rows -- three groups of three sized lines resolving to one product
--   on one purchase order. Script 41 dropped it on 2026-09-09 after establishing
--   that one line per product per order is false at KUI.
--
--   THE DECISION. Whether -EXW and -Landed name a product or a costing basis.
--   Kristy answered on 2026-09-09 -- COSTING BASES ARE SEPARATE PRODUCTS. So these
--   four lines have a product to point at, and it is the basis-specific one.
--
-- ── THE CENSUS MOVED, AND THIS IS SCOPED TO THE FOUR ────────────────────────
-- The 2026-08-31 census read 64 no-match, 89 ambiguous, 13 resolving to exactly
-- one product. Re-measured 2026-09-09 it reads 7 no-match, 89 ambiguous and
-- SIXTY-FOUR resolving to exactly one, because scripts 19, 27 to 30 and 37
-- reshaped the catalogue underneath it.
--
-- THIS SCRIPT LINKS FOUR, NOT SIXTY-FOUR. The four are the ones the decision was
-- about. The other 60 are a separate question nobody has asked yet, and linking
-- them because they happen to resolve would be answering it by accident.
--
--   d7336238  45-TORF4-2026  in_production  Adult Left-Handed Club     -> BGLHAC-EXW
--   8d224a8c  35-OAKF4-2026  in_production  Junior Right-Handed Clubs  -> BGRHJC-Landed
--   4daf5b4b  36-FBAF4-2026  in_production  Junior Right-Handed Clubs  -> BGRHJC-Landed
--   38260454  46-OAKF4-2026  shipped        Junior Right-Handed Clubs  -> BGRHJC-Landed
--
-- ── THE SNAPSHOT IS DELIBERATELY BLANKED AFTER LINKING ──────────────────────
-- THIS IS THE PART TO READ. Three of these purchase orders are in_production and
-- one is SHIPPED. All four are issued documents a factory has already received.
--
-- All four carry product_sku NULL today, so they print no SKU at all.
-- trg_poi_stamp_product_sku fires BEFORE UPDATE OF product_id and would stamp
-- BGRHJC-Landed or BGLHAC-EXW onto them -- and a reprint would then show a
-- COSTING BASIS where the factory previously saw nothing. Landed means the price
-- includes freight and duty. It is not a code a factory has any use for, and it is
-- not what was on the document they were sent.
--
-- So this links the rows and then sets product_sku back to NULL. That second
-- update does NOT re-fire the trigger -- product_id is not in its SET list, and
-- the trigger is UPDATE OF product_id. Section 6 of CATALOGUE proposed exactly
-- this, and the decision that costing bases are products does not change what
-- belongs on an issued document.
--
-- NET EFFECT. product_id is set on four lines. Every printed document says exactly
-- what it said before. b3 asserts all four snapshots are still NULL.
--
-- TO KEEP THE STAMP INSTEAD, delete the second update and change b3 to expect the
-- two sku values. That is a one-line choice and it is recorded here rather than
-- decided silently.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 160 unlinked purchase order lines. These four resolve to exactly one product
-- each by exact description-to-name match, both case-sensitively and not. All four
-- targets are active. All four lines carry product_sku NULL. Description lengths
-- 22, 25, 25, 25. Rehearsal z0, commit z0.

begin;

create temp table _pre14 on commit drop as
  select (select count(*) from vessl.purchase_order_items)                          as rows_before,
         (select count(*) from vessl.purchase_order_items where product_id is null) as unlinked_before,
         (select count(*) from vessl.purchase_order_items where product_sku is not null) as stamped_before;

create temp table _m14 (line_id uuid, target_id uuid, desc_len int) on commit drop;
insert into _m14 values
  ('d7336238-70b5-4b4d-b97b-09d309327127'::uuid, '2bf0d063-8e67-40b2-b084-e52745cb0053'::uuid, 22),
  ('8d224a8c-827f-4311-9350-2685b379f77f'::uuid, 'd942c4d8-4678-41b6-b6d0-028e0189b6fc'::uuid, 25),
  ('4daf5b4b-5dcf-428a-bf91-08273f1c2a31'::uuid, 'd942c4d8-4678-41b6-b6d0-028e0189b6fc'::uuid, 25),
  ('38260454-1d91-47a7-aa9a-f2b909476851'::uuid, 'd942c4d8-4678-41b6-b6d0-028e0189b6fc'::uuid, 25);

create temp table _b14 on commit drop as
  select i.id, i.product_id, i.product_sku, i.description, length(i.description) as desc_len, i.quantity
    from vessl.purchase_order_items i
   where i.id in (select line_id from _m14);

-- 1. LINK. Keyed on id, guarded on still-unlinked and on the raw description
--    length, so a line whose text has changed since measuring is left alone.
update vessl.purchase_order_items i
   set product_id = m.target_id
  from _m14 m
 where i.id = m.line_id
   and i.product_id is null
   and length(i.description) = m.desc_len;

-- 2. BLANK THE SNAPSHOT THE TRIGGER JUST WROTE. Does not re-fire the trigger --
--    product_id is not in this SET list and the trigger is UPDATE OF product_id.
update vessl.purchase_order_items i
   set product_sku = null
  from _m14 m
 where i.id = m.line_id;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 four lines, unlinked, at their exact description lengths' as chk,
         (select count(*)::text from _b14 b join _m14 m on m.line_id = b.id
           where b.product_id is null and b.desc_len = m.desc_len) as got, '4' as want
  union all
  select 'a1 and none of them printed a sku before',
         (select count(*)::text from _b14 where product_sku is null), '4'
  union all
  select 'a2 every target resolves to exactly one product by name',
         (select count(*)::text from _b14 b
           where (select count(*) from vessl.products p
                   where lower(btrim(p.name)) = lower(btrim(b.description))) = 1), '4'
  union all
  select 'b1 all four now carry their basis-specific product',
         (select count(*)::text from vessl.purchase_order_items i join _m14 m on m.line_id = i.id
           where i.product_id = m.target_id), '4'
  union all
  select 'b2 one on BGLHAC-EXW and three on BGRHJC-Landed',
         (select count(*) filter (where p.sku = 'BGLHAC-EXW')::text || '/' ||
                 count(*) filter (where p.sku = 'BGRHJC-Landed')::text
            from vessl.purchase_order_items i join _m14 m on m.line_id = i.id
            join vessl.products p on p.id = i.product_id), '1/3'
  union all
  -- THE ISSUED DOCUMENTS. Still printing exactly what they printed before.
  select 'b3 no line prints a sku that did not print one before',
         (select count(*)::text from vessl.purchase_order_items i join _m14 m on m.line_id = i.id
           where i.product_sku is null), '4'
  union all
  select 'b4 no description or quantity changed',
         (select count(*)::text from _b14 b join vessl.purchase_order_items i on i.id = b.id
           where i.description is not distinct from b.description
             and i.quantity is not distinct from b.quantity), '4'
  union all
  select 'b5 no OTHER line was stamped or unstamped by this script',
         (select ((select count(*) from vessl.purchase_order_items where product_sku is not null)
                - (select stamped_before from _pre14))::text), '0'
  union all
  select 'c1 unlinked purchase order lines down by exactly four',
         (select ((select unlinked_before from _pre14)
                - (select count(*) from vessl.purchase_order_items where product_id is null))::text), '4'
  union all
  -- THE 60 THIS SCRIPT DELIBERATELY DID NOT TOUCH.
  select 'c2 the other resolvable lines are still unlinked',
         (select count(*)::text from vessl.purchase_order_items i
           where i.product_id is null
             and (select count(*) from vessl.products p
                   where lower(btrim(p.name)) = lower(btrim(i.description))) = 1), '60'
  union all
  select 'c3 no purchase order line created or deleted',
         (select ((select count(*) from vessl.purchase_order_items) - (select rows_before from _pre14))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
