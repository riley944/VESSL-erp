-- 45 -- purchase order lines reach products. 71 of 156, in two passes.
--
-- The sales order side of this was script 39. This is the same job on the buy
-- side, and it is a DIFFERENT problem wearing the same shape.
--
-- ── DESCRIPTION IS THE ONLY SIGNAL ──────────────────────────────────────────
-- Script 39 had a Pass 1 worth 49 rows that needed no matching at all -- the line
-- already carried quote_id, and the quote already carried product_id. There is no
-- such column here. purchase_order_items has master_sku, vpn, pack_sku and
-- baby_sku, and ALL FOUR ARE EMPTY on all 156 unlinked lines. Measured, not
-- assumed.
--
-- So there is no stronger identifier to fall back on, and the confidence ladder
-- has to come from the QUALITY OF THE MATCH instead. That is what the two passes
-- are.
--
-- ── EVERY ONE OF THESE IS AN ISSUED DOCUMENT ────────────────────────────────
-- 156 of 156 unlinked lines sit on a NON-DRAFT purchase order. Zero drafts. And
-- 156 of 156 carry product_sku NULL, so today they print no SKU at all.
--
-- trg_poi_stamp_product_sku is BEFORE INSERT OR UPDATE OF product_id, so linking
-- stamps a SKU onto a document a factory already holds. That is script 14 exactly,
-- at 18 times the scale, and it takes the same answer -- link, then null the
-- snapshot. The second update does NOT re-fire the trigger, because product_sku is
-- not product_id and the trigger names product_id in its UPDATE OF clause.
--
-- NET EFFECT. 71 lines gain product_id. Every purchase order prints exactly what
-- it printed before. b4 asserts it across all 71 and b5 across the whole table.
--
-- ── THE TWO PASSES ──────────────────────────────────────────────────────────
--   PASS 1, 60 lines. The description matches EXACTLY ONE product in the whole
--   catalogue, and that product is selectable. Nothing to choose between.
--
--   PASS 2, 11 lines. Several products carry that name, but exactly ONE of them
--   is selectable and the rest are retired. Linking to the survivor is script 39
--   Pass 3 in reverse -- there it took a retired match because no live one
--   existed; here it takes the live one because the retired twins are history.
--
-- CASE NEVER MATTERS. 0 of 156 lines resolve differently under a case-sensitive
-- comparison than under a case-insensitive one, so this uses one comparison and
-- a5 proves the other would have agreed.
--
-- ── WHAT IS DELIBERATELY LEFT ALONE, 85 LINES ───────────────────────────────
--   70 ambiguous. Several SELECTABLE products share the name. 17 distinct
--      descriptions, and they are BucketGolf configuration variants -- tee box
--      matches NINE selectable products on its own. No text rule separates these.
--      A person has to say which product each line meant.
--    8 match only retired products, several of them, so there is no survivor to
--      pick the way pass 2 picks one.
--    7 match nothing in the catalogue at all.
-- All three sets go to Kristy. See the CATALOGUE section for the full lists.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 254 purchase order lines, 98 linked, 156 unlinked. Pass 1 resolves 60, pass 2
-- resolves 11, and the two sets do not overlap. The 71 reach 17 distinct products
-- of which 16 are new, so Ordered coverage moves 37 to 53 of 184 selectable
-- products. Script 41 removed the unique that would have blocked the repeats.
-- Rehearsal z0, commit z0.

begin;

create temp table _pre45 on commit drop as
  select (select count(*) from vessl.purchase_order_items)                              as rows_before,
         (select count(*) from vessl.purchase_order_items where product_id is null)     as unlinked_before,
         (select count(*) from vessl.purchase_order_items where product_sku is not null) as stamped_before,
         (select count(distinct i.product_id) from vessl.purchase_order_items i
            join vessl.products p on p.id = i.product_id
           where p.active is distinct from false)                                       as covered_before;

create temp table _b45 on commit drop as
  select id, product_id, product_sku, description, quantity, length(description) as d_len
    from vessl.purchase_order_items;

-- RESOLVED ONCE, BEFORE ANY WRITE. Both passes read the pre-write world, so pass 2
-- cannot be influenced by what pass 1 just linked.
create temp table _m45 (line_id uuid, target_id uuid, pass int) on commit drop;

-- PASS 1 -- exactly one product in the catalogue carries that name.
insert into _m45
select i.id, p.id, 1
  from vessl.purchase_order_items i
  join vessl.products p on lower(btrim(p.name)) = lower(btrim(i.description))
 where i.product_id is null
   and p.active is distinct from false
   and (select count(*) from vessl.products x
         where lower(btrim(x.name)) = lower(btrim(i.description))) = 1;

-- PASS 2 -- several carry it, exactly one of them is still selectable.
insert into _m45
select i.id, p.id, 2
  from vessl.purchase_order_items i
  join vessl.products p on lower(btrim(p.name)) = lower(btrim(i.description))
 where i.product_id is null
   and p.active is distinct from false
   and (select count(*) from vessl.products x
         where lower(btrim(x.name)) = lower(btrim(i.description))) > 1
   and (select count(*) from vessl.products x
         where lower(btrim(x.name)) = lower(btrim(i.description))
           and x.active is distinct from false) = 1;

-- 1. LINK.
update vessl.purchase_order_items i
   set product_id = m.target_id
  from _m45 m
 where i.id = m.line_id
   and i.product_id is null;

-- 2. BLANK THE SNAPSHOT THE TRIGGER JUST WROTE. Does not re-fire it -- product_id
--    is not in this SET list and the trigger is UPDATE OF product_id.
update vessl.purchase_order_items i
   set product_sku = null
  from _m45 m
 where i.id = m.line_id;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 pass 1 resolved its sixty lines' as chk,
         (select count(*)::text from _m45 where pass = 1) as got, '60' as want
  union all
  select 'a1 pass 2 resolved its eleven',
         (select count(*)::text from _m45 where pass = 2), '11'
  union all
  -- THE TWO PASSES MUST NOT OVERLAP, or a line would be written twice and the
  -- second write would silently decide which product it points at.
  select 'a2 no line was resolved by both passes',
         (select count(*)::text from (select line_id from _m45 group by line_id having count(*) > 1) d), '0'
  union all
  select 'a3 every resolved line was unlinked beforehand',
         (select count(*)::text from _b45 b join _m45 m on m.line_id = b.id
           where b.product_id is null), '71'
  union all
  -- The reason the snapshots are nulled below. None of these printed a SKU.
  select 'a4 and none of them printed a sku beforehand',
         (select count(*)::text from _b45 b join _m45 m on m.line_id = b.id
           where b.product_sku is null), '71'
  union all
  -- Case-sensitivity, proven irrelevant rather than assumed.
  select 'a5 a case sensitive match would have chosen the same targets',
         (select count(*)::text from _m45 m
            join vessl.purchase_order_items i on i.id = m.line_id
            join vessl.products p on p.id = m.target_id
           where p.name = i.description), '71'
  union all
  select 'b1 all seventy one now carry a product',
         (select count(*)::text from vessl.purchase_order_items i join _m45 m on m.line_id = i.id
           where i.product_id = m.target_id), '71'
  union all
  select 'b2 pass 1 lines point at their pass 1 target',
         (select count(*)::text from vessl.purchase_order_items i join _m45 m on m.line_id = i.id
           where m.pass = 1 and i.product_id = m.target_id), '60'
  union all
  select 'b3 pass 2 lines point at their pass 2 target',
         (select count(*)::text from vessl.purchase_order_items i join _m45 m on m.line_id = i.id
           where m.pass = 2 and i.product_id = m.target_id), '11'
  union all
  select 'b4 every target is a selectable product',
         (select count(*)::text from _m45 m join vessl.products p on p.id = m.target_id
           where p.active is distinct from false), '71'
  union all
  -- THE ISSUED DOCUMENTS. Still printing exactly what they printed before.
  select 'b5 not one of the seventy one prints a sku',
         (select count(*)::text from vessl.purchase_order_items i join _m45 m on m.line_id = i.id
           where i.product_sku is null), '71'
  union all
  select 'b6 and no OTHER line was stamped or unstamped',
         (select ((select count(*) from vessl.purchase_order_items where product_sku is not null)
                - (select stamped_before from _pre45))::text), '0'
  union all
  select 'b7 no description or quantity changed anywhere',
         (select count(*)::text from _b45 b join vessl.purchase_order_items i on i.id = b.id
           where i.description is not distinct from b.description
             and i.quantity is not distinct from b.quantity), '254'
  union all
  select 'c1 unlinked lines down by exactly seventy one',
         (select ((select unlinked_before from _pre45)
                - (select count(*) from vessl.purchase_order_items where product_id is null))::text), '71'
  union all
  -- THE EIGHTY FIVE THIS SCRIPT DELIBERATELY DID NOT TOUCH.
  select 'c2 the ambiguous and unmatched are still unlinked',
         (select count(*)::text from vessl.purchase_order_items where product_id is null), '85'
  union all
  select 'c3 ordered coverage moved thirty seven to fifty three',
         (select (select covered_before from _pre45)::text || ' to ' ||
                 (select count(distinct i.product_id) from vessl.purchase_order_items i
                    join vessl.products p on p.id = i.product_id
                   where p.active is distinct from false)::text), '37 to 53'
  union all
  select 'c4 no purchase order line created or deleted',
         (select ((select count(*) from vessl.purchase_order_items) - (select rows_before from _pre45))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
