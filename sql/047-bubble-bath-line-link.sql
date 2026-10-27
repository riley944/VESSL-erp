-- 47 -- the one purchase order line script 46 made resolvable.
--
-- Script 45 linked 71 of 156 and left this one in the no-match group, because the
-- product it names was called LLW-1545 Blue Bottle Bubble Bath rather than Blue
-- Bottle Bubble Bath. Script 46 stripped that prefix. This collects the line.
--
--   line   f873c442  Blue Bottle Bubble Bath  qty 45000
--   on     purchase order 1302600279256, in_production
--   to     LLW-1545, ee9db0fd, selectable
--
-- ── WHY THIS IS A NEW SCRIPT AND NOT A RE-RUN OF 45 ─────────────────────────
-- Script 45 cannot be run twice. Its wants are the literals it measured -- 60,
-- 11, 71, 85 and the coverage string 37 to 53 -- so a second run fails at a0
-- rather than quietly linking whatever it finds. That is the guard working, not a
-- defect, and the answer is a script with its own measured wants rather than an
-- edit to a file that is already the as-run record of what it did.
--
-- ── SAME RULE AS 45 PASS 1, ON ONE ROW ──────────────────────────────────────
-- The description matches exactly one product in the whole catalogue and that
-- product is selectable. a2 proves the exactly-one, so this is pass 1 applied
-- rather than a hand-picked pairing that happens to look right.
--
-- ── THE SNAPSHOT IS BLANKED, FOR THE THIRD TIME ─────────────────────────────
-- The purchase order is in_production and the line prints NO SKU today. Linking
-- fires trg_poi_stamp_product_sku and would put LLW-1545 in front of a factory
-- that has never seen it, on a document already issued.
--
-- So this links and then nulls, exactly as scripts 14 and 45 did. The second
-- update does not re-fire the trigger -- product_sku is not product_id, and the
-- trigger names product_id in its UPDATE OF clause.
--
-- b3 asserts the line still prints nothing. b4 asserts no OTHER line in the table
-- gained or lost a stamp, which also covers the second line on this same purchase
-- order -- there are two, and only one of them is this one.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- The line is unlinked, its description is 23 characters, its product_sku is
-- NULL. LLW-1545 is selectable and its name is 23 characters, the same length,
-- which is what the strip in script 46 produced. Exactly one product in the
-- catalogue carries that name. Ordered coverage is 53 of 184 and this moves it to
-- 54. Rehearsal z0, commit z0.

begin;

create temp table _pre47 on commit drop as
  select (select count(*) from vessl.purchase_order_items)                              as rows_before,
         (select count(*) from vessl.purchase_order_items where product_id is null)     as unlinked_before,
         (select count(*) from vessl.purchase_order_items where product_sku is not null) as stamped_before,
         (select count(distinct i.product_id) from vessl.purchase_order_items i
            join vessl.products p on p.id = i.product_id
           where p.active is distinct from false)                                       as covered_before;

create temp table _b47 on commit drop as
  select i.id, i.product_id, i.product_sku, i.description, i.quantity,
         length(i.description) as d_len
    from vessl.purchase_order_items i
   where i.id = 'f873c442-cd64-44fe-ac9e-bf11880e5043'::uuid;

-- 1. LINK. Guarded on still-unlinked and on the raw description length, so a line
--    whose text has changed since measuring is left alone rather than linked on a
--    stale premise.
update vessl.purchase_order_items i
   set product_id = 'ee9db0fd-b35d-429e-a78c-a74ffcecd738'::uuid
 where i.id = 'f873c442-cd64-44fe-ac9e-bf11880e5043'::uuid
   and i.product_id is null
   and length(i.description) = 23;

-- 2. BLANK THE SNAPSHOT THE TRIGGER JUST WROTE.
update vessl.purchase_order_items i
   set product_sku = null
 where i.id = 'f873c442-cd64-44fe-ac9e-bf11880e5043'::uuid;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the line was unlinked, at its exact description length' as chk,
         (select count(*)::text from _b47 where product_id is null and d_len = 23) as got, '1' as want
  union all
  select 'a1 and it printed no sku beforehand',
         (select count(*)::text from _b47 where product_sku is null), '1'
  union all
  -- PASS 1 APPLIED, NOT A HAND PICKED PAIRING. Exactly one product carries it.
  select 'a2 exactly one product in the catalogue carries that name',
         (select count(*)::text from vessl.products p
           where lower(btrim(p.name)) = 'blue bottle bubble bath'), '1'
  union all
  select 'a3 and that product is the selectable LLW-1545',
         (select p.sku::text from vessl.products p
           where lower(btrim(p.name)) = 'blue bottle bubble bath'
             and p.active is distinct from false), 'LLW-1545'
  union all
  select 'b1 the line now carries LLW-1545',
         (select count(*)::text from vessl.purchase_order_items i
           where i.id = 'f873c442-cd64-44fe-ac9e-bf11880e5043'::uuid
             and i.product_id = 'ee9db0fd-b35d-429e-a78c-a74ffcecd738'::uuid), '1'
  union all
  -- THE ISSUED DOCUMENT. Still printing exactly what it printed before.
  select 'b3 and still prints no sku at all',
         (select count(*)::text from vessl.purchase_order_items i
           where i.id = 'f873c442-cd64-44fe-ac9e-bf11880e5043'::uuid
             and i.product_sku is null), '1'
  union all
  select 'b4 no other line was stamped or unstamped',
         (select ((select count(*) from vessl.purchase_order_items where product_sku is not null)
                - (select stamped_before from _pre47))::text), '0'
  union all
  select 'b5 its description and quantity are untouched',
         (select count(*)::text from _b47 b join vessl.purchase_order_items i on i.id = b.id
           where i.description is not distinct from b.description
             and i.quantity is not distinct from b.quantity), '1'
  union all
  select 'c1 unlinked lines down by exactly one',
         (select ((select unlinked_before from _pre47)
                - (select count(*) from vessl.purchase_order_items where product_id is null))::text), '1'
  union all
  select 'c2 eighty four remain, and they are the ones for Kristy',
         (select count(*)::text from vessl.purchase_order_items where product_id is null), '84'
  union all
  select 'c3 ordered coverage moved fifty three to fifty four',
         (select (select covered_before from _pre47)::text || ' to ' ||
                 (select count(distinct i.product_id) from vessl.purchase_order_items i
                    join vessl.products p on p.id = i.product_id
                   where p.active is distinct from false)::text), '53 to 54'
  union all
  select 'c4 no purchase order line created or deleted',
         (select ((select count(*) from vessl.purchase_order_items) - (select rows_before from _pre47))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
