-- 41 -- drop UNIQUE (order_id, product_id) from both order-item tables.
--
-- RUN THIS BEFORE SCRIPT 39. Script 39 aborted at its first write with 23505 on
-- sales_order_items_sales_order_id_product_id_key. The constraint, not the script,
-- is what is wrong.
--
-- ── THE PREMISE THE CONSTRAINT ENCODES IS FALSE AT KUI ──────────────────────
-- It says one line per product per order. That is not how this business sells or
-- buys. SIZES, PRICE BREAKS and SPLIT DELIVERIES all legitimately repeat a
-- product on one order, and the data already shows it four times over.
--
-- Measured on the 231 rows script 39 would link -- 12 rows in 4 groups collide,
-- and every one is the same shape, one product in several sizes on one order.
--
--   KUI072726B  CHP Sweatpants Blanks   3 lines  sizes L, M, XL
--   KUI072726B  CHP Sweatshirt Blanks   3 lines  sizes L, M, XL
--   KUI072726C  CHP PT Tee              3 lines  sizes L, M, XL
--   119909      LL1-380                 3 lines  Small, Medium and Large -- carried
--                                                in the DESCRIPTION, size column
--                                                NULL, at 1600, 1200 and 800 units
--                                                and three different client prices
--
-- The last one is the same shape wearing different clothes, and it is the reason
-- the obvious narrower constraint does not work.
--
-- ── OPTIONS CONSIDERED AND REJECTED ─────────────────────────────────────────
-- A. UNIQUE (order_id, product_id, size). Fixes the three CHP groups. Does NOT
--    really fix LL1-380 -- standard UNIQUE treats NULLs as distinct, so those
--    three pass only BECAUSE size is NULL, and by that same rule the constraint
--    would then permit unlimited unsized duplicates. It stops constraining
--    exactly where it currently works.
--
-- B. UNIQUE NULLS NOT DISTINCT (order_id, product_id, size). Postgres is 17.6 so
--    this is available, and it closes the hole in A -- which means it STILL
--    blocks LL1-380, because all three collapse to one key. Adopting it would
--    require first moving Small, Medium and Large out of the descriptions of
--    ISSUED sales orders into the size column. Rewriting prose on issued
--    documents to satisfy a constraint we have just established is wrong is the
--    wrong order of operations.
--
-- D. Leave it and have script 39 skip the collisions. Links 219 instead of 231
--    and leaves 12 rows unlinked for a reason nobody will remember in a month.
--
-- C, TAKEN. Drop both. A sales order line is not identified by its product, and
-- neither is a purchase order line.
--
-- ── NOTHING DEPENDS ON THEM ─────────────────────────────────────────────────
-- Every upsert and onConflict in app/ and lib/ was checked. The only onConflict
-- targets anywhere are companies name-and-type, product_regulations and
-- product_materials. NOTHING upserts an order item, and no view or print path
-- assumes one line per product -- the sales order form and the purchase order
-- document both iterate lines.
--
-- id remains the PRIMARY KEY on both tables, so row identity is untouched. This
-- removes a uniqueness rule, not a key.
--
-- ── IT ALSO CLEARS HALF OF THE SCRIPT 14 PARK ───────────────────────────────
-- CATALOGUE section 5 records this same constraint on purchase_order_items
-- stopping 9 of script 14 rows -- three groups of three lines resolving to one
-- product on one purchase order, which is the identical three-sizes shape. That
-- blocker is gone after this.
--
-- THE OTHER HALF OF THAT PARK IS UNAFFECTED AND STAYS WITH KRISTY. Script 14 also
-- waits on which product the four -EXW and -Landed rows really are, and that is a
-- decision about product identity, not a constraint. Nothing here answers it.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- Both tables carry exactly 1 unique constraint, 1 primary key, 2 foreign keys,
-- 0 check constraints, 4 indexes, 3 policies and RLS on. purchase_order_items
-- carries trg_poi_stamp_product_sku; sales_order_items has no trigger. 255 sales
-- order items, 254 purchase order items, 0 existing violations of either
-- constraint. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, from the catalogue, so the after checks compare rather than
-- assume. Everything except the two unique constraints must come through
-- unchanged, and these are the numbers that prove it.
create temp table _pre41 on commit drop as
  select c.relname                                                              as tbl,
         count(*) filter (where con.contype = 'u')                              as uniques,
         count(*) filter (where con.contype = 'p')                              as pkeys,
         count(*) filter (where con.contype = 'f')                              as fkeys,
         count(*) filter (where con.contype = 'c')                              as checks,
         (select count(*) from pg_indexes i
           where i.schemaname = 'vessl' and i.tablename = c.relname)            as idx,
         (select count(*) from pg_policies p
           where p.schemaname = 'vessl' and p.tablename = c.relname)            as policies,
         c.relrowsecurity                                                       as rls,
         (select count(*) from pg_trigger t
           where t.tgrelid = c.oid and not t.tgisinternal)                      as triggers
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'vessl'
     and c.relname in ('sales_order_items', 'purchase_order_items')
   group by c.relname, c.relrowsecurity, c.oid;

create temp table _cnt41 on commit drop as
  select (select count(*) from vessl.sales_order_items)    as soi_before,
         (select count(*) from vessl.purchase_order_items) as poi_before;

alter table vessl.sales_order_items
  drop constraint sales_order_items_sales_order_id_product_id_key;

alter table vessl.purchase_order_items
  drop constraint purchase_order_items_purchase_order_id_product_id_key;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 both tables carried exactly one unique constraint before' as chk,
         (select string_agg(uniques::text, '/' order by tbl) from _pre41) as got, '1/1' as want
  union all
  select 'a1 and one primary key each, which is what row identity rests on',
         (select string_agg(pkeys::text, '/' order by tbl) from _pre41), '1/1'
  union all
  -- THE WRITE, PROVEN GONE BY NAME rather than by counting to zero -- a count
  -- would also read right if some other unique had been dropped instead.
  select 'b1 the sales_order_items unique is gone, by name',
         (select count(*)::text from pg_constraint con join pg_class c on c.oid = con.conrelid
           where c.relname = 'sales_order_items'
             and con.conname = 'sales_order_items_sales_order_id_product_id_key'), '0'
  union all
  select 'b2 the purchase_order_items unique is gone, by name',
         (select count(*)::text from pg_constraint con join pg_class c on c.oid = con.conrelid
           where c.relname = 'purchase_order_items'
             and con.conname = 'purchase_order_items_purchase_order_id_product_id_key'), '0'
  union all
  select 'b3 no unique constraint remains on either table',
         (select count(*)::text from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and con.contype = 'u'
             and c.relname in ('sales_order_items','purchase_order_items')), '0'
  union all
  -- EVERYTHING ELSE UNCHANGED, compared against the snapshot rather than to a
  -- literal, so this stays true if a policy or index is added tomorrow.
  select 'c1 primary keys unchanged',
         (select string_agg(x.now::text, '/' order by x.tbl) from (
            select c.relname as tbl, count(*) filter (where con.contype='p') as now
              from pg_constraint con join pg_class c on c.oid=con.conrelid
              join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='vessl' and c.relname in ('sales_order_items','purchase_order_items')
             group by c.relname) x),
         (select string_agg(pkeys::text, '/' order by tbl) from _pre41)
  union all
  select 'c2 foreign keys unchanged',
         (select string_agg(x.now::text, '/' order by x.tbl) from (
            select c.relname as tbl, count(*) filter (where con.contype='f') as now
              from pg_constraint con join pg_class c on c.oid=con.conrelid
              join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='vessl' and c.relname in ('sales_order_items','purchase_order_items')
             group by c.relname) x),
         (select string_agg(fkeys::text, '/' order by tbl) from _pre41)
  union all
  -- Indexes drop by exactly one each, because a unique constraint owns an index
  -- and taking the constraint takes that index with it. Anything else means
  -- something unintended went too.
  select 'c3 indexes down by exactly one on each table',
         (select string_agg(((select count(*) from pg_indexes i
                               where i.schemaname='vessl' and i.tablename = pre.tbl)
                             - pre.idx)::text, '/' order by pre.tbl) from _pre41 pre), '-1/-1'
  union all
  select 'c4 policies and row level security unchanged',
         (select string_agg(((select count(*) from pg_policies p
                               where p.schemaname='vessl' and p.tablename = pre.tbl))::text
                            || ' rls ' || (select c.relrowsecurity::text from pg_class c
                                        join pg_namespace n on n.oid=c.relnamespace
                                       where n.nspname='vessl' and c.relname = pre.tbl),
                            '/' order by pre.tbl) from _pre41 pre), '3 rls true/3 rls true'
  union all
  select 'c5 the stamping trigger on purchase_order_items survived',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.relname = 'purchase_order_items' and t.tgname = 'trg_poi_stamp_product_sku'), '1'
  union all
  select 'c6 no check constraint appeared on either table',
         (select count(*)::text from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname='vessl' and con.contype = 'c'
             and c.relname in ('sales_order_items','purchase_order_items')), '0'
  union all
  select 'd1 no sales order item created or deleted',
         (select ((select count(*) from vessl.sales_order_items) - (select soi_before from _cnt41))::text), '0'
  union all
  select 'd2 no purchase order item created or deleted',
         (select ((select count(*) from vessl.purchase_order_items) - (select poi_before from _cnt41))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
