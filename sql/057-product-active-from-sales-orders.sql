-- 57 -- ordered means a purchase order OR a sales order, in the catalogue flag too.
--
-- Script 52 reconciled products.active against purchase order lines only. Since
-- a74c8fc, PLM treats a product as ordered once it has a purchase order line OR a
-- sales order line, and the Products list now counts both as well. This brings
-- the flag into line with that one definition.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────────────
-- 36 products carry at least one sales order line and have active NULL. They go
-- to true. Retired rows, active false, are not touched, and nothing that is true
-- today changes.
--   28 of the 36 were set to NULL by script 52 on 2026-09-14, because 52 counted
--      purchase order lines alone and these had none. They had been sold.
--   8 have purchase order lines as well and were already NULL -- 52 moved only
--      rows that were false.
--
-- ── WHAT IS HELD ────────────────────────────────────────────────────────────
-- BUC-138 is the 37th row with a sales order line and active NULL. Its only sales
-- order is on ZZTESTER, the throwaway test client, and a test order is no reason
-- to put a real product in service. It stays NULL. The test client is named by
-- id, with the length of its name as a second key, never by its name alone.
--
-- ── NOT IN SCOPE ────────────────────────────────────────────────────────────
-- 11 products have purchase order lines only and are still NULL. All 11 are LHS
-- parents, LHS-152 and LHS-170 to LHS-187, which ties them to script B and the
-- sizes decision rather than to this script.
--
-- ── ARCHIVE ─────────────────────────────────────────────────────────────────
-- archive/2026-09-15-product-active-sales-orders.json holds all 37 product rows as
-- they stood, with their sales order lines, exported before this was written.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 352 products -- 65 true, 137 false, 150 NULL. 37 with a sales order line and
-- NULL, exactly one of them on ZZTESTER alone. LL1-1212, LL1-1213 and LL1-1214
-- each share their SKU with one other row. NULL to true does not change which
-- rows count as not retired, so the retired-SKU test the quote save relies on
-- reads exactly as it did.

begin;

-- ── The target set, captured as ids BEFORE anything is written ──────────────
-- A row qualifies when it is NULL and at least one of its sales order lines is on
-- a client other than the test client. A line with no client counts as not the
-- test client, which is what is distinct from gives.
create temp table t_to_true on commit drop as
select p.id
  from vessl.products p
 where p.active is null
   and exists (select 1
                 from vessl.sales_order_items s
                 join vessl.sales_orders so on so.id = s.sales_order_id
                where s.product_id = p.id
                  and so.client_company_id is distinct from '46329254-e025-4b73-a2e4-e1bf85ee546e');

-- The rest of the NULL rows with a sales order line. Expected to be BUC-138 alone.
create temp table t_held on commit drop as
select p.id
  from vessl.products p
 where p.active is null
   and exists (select 1 from vessl.sales_order_items s where s.product_id = p.id)
   and p.id not in (select id from t_to_true);

-- ── Baselines, so the checks can prove what did NOT move ───────────────────
create temp table t_base on commit drop as
select (select count(*) from vessl.products)                         as base_products,
       (select count(*) from vessl.products where active is true)    as base_true,
       (select count(*) from vessl.products where active is false)   as base_false,
       (select count(*) from vessl.products where active is null)    as base_null,
       (select count(*) from vessl.quotes)                           as base_quotes,
       (select count(*) from vessl.purchase_order_items)             as base_poi,
       (select count(*) from vessl.sales_order_items)                as base_soi,
       (select count(*) from vessl.programs)                         as base_programs,
       (select count(*) from vessl.companies
         where id = '46329254-e025-4b73-a2e4-e1bf85ee546e' and length(name) = 8) as zz_client,
       (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                              || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
          from vessl.products p where p.id not in (select id from t_to_true)) as others_stamp,
       (select md5(string_agg(p.id::text || '|' || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
          from vessl.products p where p.active is false) as retired_stamp;

-- REFUSE rather than flip a set that is not the one measured.
do $guard$
begin
  if (select count(*) from t_to_true) <> 36
     or (select count(*) from t_held) <> 1
     or (select zz_client from t_base) <> 1 then
    raise exception 'the target set no longer matches what was measured, nothing changed';
  end if;
end
$guard$;

-- ── The write, guarded on the value each row still holds ───────────────────
update vessl.products p
   set active = true,
       updated_at = now()
  from t_to_true t
 where p.id = t.id
   and p.active is null;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
with _pre57 as (
  select (select count(*) from t_to_true) as n_targets,
         (select count(*) from t_held)    as n_held,
         (select count(*) from vessl.products p join t_to_true t on t.id = p.id where p.active is true) as true_landed,
         (select count(*) from vessl.products p join t_held h on h.id = p.id where p.active is null)    as held_still_null,
         (select count(*) from vessl.products where active is true)  as now_true,
         (select count(*) from vessl.products where active is false) as now_false,
         (select count(*) from vessl.products where active is null)  as now_null,
         (select count(*) from vessl.products p
           where p.active is null
             and exists (select 1 from vessl.sales_order_items s
                           join vessl.sales_orders so on so.id = s.sales_order_id
                          where s.product_id = p.id
                            and so.client_company_id is distinct from '46329254-e025-4b73-a2e4-e1bf85ee546e')) as sold_still_null,
         (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                                || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
            from vessl.products p where p.id not in (select id from t_to_true)) as others_now,
         (select md5(string_agg(p.id::text || '|' || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
            from vessl.products p where p.active is false) as retired_now,
         (select count(*) from vessl.products)             as now_products,
         (select count(*) from vessl.quotes)               as now_quotes,
         (select count(*) from vessl.purchase_order_items) as now_poi,
         (select count(*) from vessl.sales_order_items)    as now_soi,
         (select count(*) from vessl.programs)             as now_programs,
         b.base_products, b.base_true, b.base_false, b.base_null, b.base_quotes, b.base_poi,
         b.base_soi, b.base_programs, b.zz_client, b.others_stamp, b.retired_stamp
    from t_base b
)
select * from (
  select 'a0 36 rows were selected for true, before any write' as chk,
         (select n_targets::text from _pre57) as got, '36' as want
  union all
  select 'a1 one row held, its only sales on the test client',
         (select n_held::text from _pre57), '1'
  union all
  select 'a2 the test client matched by id and name length',
         (select zz_client::text from _pre57), '1'
  union all
  select 'b1 every selected row now reads true',
         (select true_landed::text from _pre57), '36'
  union all
  select 'b2 active true moved by exactly plus 36',
         (select (now_true = base_true + 36)::text from _pre57), 'true'
  union all
  select 'b3 active null moved by exactly minus 36',
         (select (now_null = base_null - 36)::text from _pre57), 'true'
  union all
  select 'b4 active false did not move',
         (select (now_false = base_false)::text from _pre57), 'true'
  union all
  select 'b5 the held row is still NULL',
         (select held_still_null::text from _pre57), '1'
  union all
  -- NOTHING ELSE MOVED. Every product outside the 36 keeps its active and its
  -- updated_at exactly, the held row and every retired row included.
  select 'b6 no other product changed active or updated_at',
         (select (others_now = others_stamp)::text from _pre57), 'true'
  union all
  select 'b7 no retired row changed at all',
         (select (retired_now = retired_stamp)::text from _pre57), 'true'
  union all
  select 'b8 no product sold off the test client is still NULL',
         (select sold_still_null::text from _pre57), '0'
  union all
  select 'c1 product row count unchanged',
         (select (now_products - base_products)::text from _pre57), '0'
  union all
  select 'c2 quotes, PO lines, SO lines and programs unchanged',
         (select (now_quotes - base_quotes)::text || '/' || (now_poi - base_poi)::text || '/'
                 || (now_soi - base_soi)::text || '/' || (now_programs - base_programs)::text from _pre57), '0/0/0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
