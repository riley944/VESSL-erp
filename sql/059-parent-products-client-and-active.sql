-- 59 -- nine parent products from a sheet.
--
-- The sheet is the Products page export, edited by hand and handed back. Only two
-- of its columns are product fields. Client becomes products.client_company_id and
-- Catalogue status becomes products.active. SKU and Product name identify nothing
-- here, because the sheet carries Product ID and that is what every row below is
-- keyed on.
--
-- NOT PRODUCT FIELDS, and deliberately ignored. Factory, Country, Tiers, Min price,
-- Max price, Avg margin and Quote date all live on the QUOTE, not on the product,
-- and Order state is derived from order lines rather than stored anywhere. Writing
-- any of them onto a product row is impossible, since there is no column, and
-- editing the quotes they came from is a different decision nobody has asked for.
--
-- WHAT MOVES
--   9 rows gain a client. All nine hold NULL today, so none is overwritten.
--   2 of those 9 also go active, BG-104 and BG-113, both NULL today. The sheet marks
--     BG-101 Active as well and it already is, so it needs no write.
--   1 row, LL1-1591, goes the other way. It reads false today and becomes NULL, not
--     recorded, and is renamed to Ollie Water Bottle.
--
-- THE RENAME, AND WHY THE GUARD CHECKS IT
--   products_sku_name_key is UNIQUE over sku and name together, and SKU LL1-1591 is
--   carried by THREE rows. The other two are Olivia small water bottle and Youth
--   steel water bottle, both inactive, and both stay exactly as they are. The new
--   name is free on that SKU today, measured, and the guard re-proves it rather than
--   trusting the measurement, so a collision cannot turn into a failed transaction
--   halfway through.
--
-- ARCHIVE
--   archive/2026-09-16-parent-products-upload.xlsx is the sheet as received, and
--   archive/2026-09-16-parent-products-client-upload.json holds all nine rows as they
--   stand, exported before this was written.
--
-- MEASURED BEFORE WRITING, against the live database
--   All nine ids resolve, and every SKU in the sheet matches the row its id points
--   at. All nine carry no client today. Five companies resolve by name, each to
--   exactly one client row, and the guard matches them by id with the length of the
--   name as a second key, never by the name alone.

begin;

-- The sheet, as ids. set_active carries the Catalogue status column, true only where
-- the sheet says Active AND the row is not already active.
--
-- Columns named rather than starred, because preflight reads the verification block
-- as everything from the first select star from open-paren in the file and a starred
-- VALUES list here would be parsed as branches.
create temp table t_upload on commit drop as
select v.product_id, v.client_id, v.set_active from (values
  ('27cd9efb-36c5-4be5-84b8-addbf6e8fad1'::uuid, '771dc750-929c-4b8f-a279-53404e94da60'::uuid, false),
  ('3bc486c2-eaec-4ead-860b-e54699f1270d'::uuid, '771dc750-929c-4b8f-a279-53404e94da60'::uuid, true),
  ('3b02e854-a4e5-43a3-95e1-21cbc9771d90'::uuid, '771dc750-929c-4b8f-a279-53404e94da60'::uuid, true),
  ('5b1d9419-f47c-491d-8cc0-7dea84e2b0ee'::uuid, 'a08f3431-62e3-4a75-9637-7291d82c4552'::uuid, false),
  ('0c3830cb-4b84-4e41-ad68-c0464f69dc32'::uuid, 'a08f3431-62e3-4a75-9637-7291d82c4552'::uuid, false),
  ('f1cab2b6-1618-43f5-ad2d-644e0b6066b2'::uuid, '7a93f704-8154-4c34-8d50-a31a87c36c3c'::uuid, false),
  ('6e44c7f8-6fa0-44d9-8e95-2f7a232a6d88'::uuid, '687905e0-3899-4461-ac53-98fdde37410b'::uuid, false),
  ('2edeaee1-24ab-4dbd-80de-686d0de42701'::uuid, '687905e0-3899-4461-ac53-98fdde37410b'::uuid, false),
  ('9556f7aa-feb2-445c-bafd-8c41066826c8'::uuid, '7657f045-1eb9-4454-9dd1-7fddb470df05'::uuid, false)
) as v(product_id, client_id, set_active);

-- The two rows sharing SKU LL1-1591 with the row being renamed. Named so the checks
-- can prove they were left alone, by id rather than by name.
create temp table t_siblings on commit drop as
select v.product_id from (values
  ('5c66a187-0c91-4b0c-8cdb-158c03f5bb6a'::uuid),
  ('76a937c9-87c1-437f-b839-8e64fba52e77'::uuid)
) as v(product_id);

-- Baselines, so the checks can prove what did NOT move. The collision count is taken
-- HERE, before the rename, because afterwards the renamed row itself carries the new
-- name and the same query would read 1 by design.
create temp table t_base on commit drop as
select (select count(*) from vessl.products)                         as base_products,
       (select count(*) from vessl.products where active is true)    as base_true,
       (select count(*) from vessl.products where active is false)   as base_false,
       (select count(*) from vessl.products where active is null)    as base_null,
       (select count(*) from vessl.products where client_company_id is null) as base_noclient,
       (select count(*) from vessl.products
         where sku = 'LL1-1591' and name = 'Ollie Water Bottle')     as base_collision,
       (select count(*) from vessl.companies)                        as base_companies,
       (select count(*) from vessl.quotes)                           as base_quotes,
       (select count(*) from vessl.purchase_order_items)             as base_poi,
       (select count(*) from vessl.sales_order_items)                as base_soi,
       (select count(*) from vessl.programs)                         as base_programs,
       (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                              || coalesce(p.client_company_id::text, 'null') || '|' || p.name || '|'
                              || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
          from vessl.products p
         where p.id not in (select product_id from t_upload)) as others_stamp;

-- REFUSE rather than write a set that is not the one measured.
do $guard$
begin
  if (select count(*) from t_upload) <> 9
     or (select count(*) from vessl.products p join t_upload t on t.product_id = p.id) <> 9
     or (select count(*) from vessl.products p join t_upload t on t.product_id = p.id
          where p.client_company_id is null) <> 9
     or (select count(*) from vessl.products p join t_upload t on t.product_id = p.id
          where t.set_active is true and p.active is null) <> 2
     or (select count(*) from vessl.companies c
          where (c.id = '771dc750-929c-4b8f-a279-53404e94da60' and length(c.name) = 10)
             or (c.id = 'a08f3431-62e3-4a75-9637-7291d82c4552' and length(c.name) = 15)
             or (c.id = '7a93f704-8154-4c34-8d50-a31a87c36c3c' and length(c.name) = 10)
             or (c.id = '687905e0-3899-4461-ac53-98fdde37410b' and length(c.name) = 8)
             or (c.id = '7657f045-1eb9-4454-9dd1-7fddb470df05' and length(c.name) = 9)) <> 5
     or (select count(*) from vessl.products
          where id = '2edeaee1-24ab-4dbd-80de-686d0de42701'
            and active is false and length(name) = 24) <> 1
     or (select base_collision from t_base) <> 0
     or (select count(*) from vessl.products p join t_siblings s on s.product_id = p.id
          where p.sku = 'LL1-1591' and p.active is false) <> 2 then
    raise exception 'the sheet no longer matches the database, nothing changed';
  end if;
end
$guard$;

-- The writes, each guarded on the value the row still holds.
update vessl.products p
   set client_company_id = t.client_id,
       updated_at = now()
  from t_upload t
 where p.id = t.product_id
   and p.client_company_id is null;

update vessl.products p
   set active = true,
       updated_at = now()
  from t_upload t
 where p.id = t.product_id
   and t.set_active is true
   and p.active is null;

-- LL1-1591 alone, by id. Retired becomes not recorded, and the name loses the word
-- the sheet dropped. Its two siblings keep their names and stay inactive.
update vessl.products
   set active = null,
       name = 'Ollie Water Bottle',
       updated_at = now()
 where id = '2edeaee1-24ab-4dbd-80de-686d0de42701'
   and active is false
   and length(name) = 24;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
with _pre59 as (
  select (select count(*) from t_upload) as n_rows,
         (select count(*) from vessl.products p join t_upload t on t.product_id = p.id
           where p.client_company_id = t.client_id) as client_landed,
         (select count(*) from vessl.products p join t_upload t on t.product_id = p.id
           where t.set_active is true and p.active is true) as active_landed,
         (select count(*) from vessl.products
           where id = '2edeaee1-24ab-4dbd-80de-686d0de42701'
             and name = 'Ollie Water Bottle' and length(name) = 18) as renamed,
         (select count(*) from vessl.products
           where id = '2edeaee1-24ab-4dbd-80de-686d0de42701' and active is null) as renamed_notset,
         -- EACH SIBLING BY ID WITH ITS OWN NAME LENGTH. One length for both was wrong
         -- and failed the first rehearsal -- Olivia small water bottle is 25 characters
         -- and Youth steel water bottle is 24. b10 already proves nothing about them
         -- changed, so what this adds is which two rows they are.
         (select count(*) from vessl.products p
           where (p.id = '5c66a187-0c91-4b0c-8cdb-158c03f5bb6a' and length(p.name) = 25 and p.active is false)
              or (p.id = '76a937c9-87c1-437f-b839-8e64fba52e77' and length(p.name) = 24 and p.active is false)) as siblings_held,
         (select count(*) from vessl.companies c
           where (c.id = '771dc750-929c-4b8f-a279-53404e94da60' and length(c.name) = 10)
              or (c.id = 'a08f3431-62e3-4a75-9637-7291d82c4552' and length(c.name) = 15)
              or (c.id = '7a93f704-8154-4c34-8d50-a31a87c36c3c' and length(c.name) = 10)
              or (c.id = '687905e0-3899-4461-ac53-98fdde37410b' and length(c.name) = 8)
              or (c.id = '7657f045-1eb9-4454-9dd1-7fddb470df05' and length(c.name) = 9)) as companies_ok,
         (select count(*) from vessl.products where active is true)  as now_true,
         (select count(*) from vessl.products where active is false) as now_false,
         (select count(*) from vessl.products where active is null)  as now_null,
         (select count(*) from vessl.products where client_company_id is null) as now_noclient,
         (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                                || coalesce(p.client_company_id::text, 'null') || '|' || p.name || '|'
                                || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
            from vessl.products p
           where p.id not in (select product_id from t_upload)) as others_now,
         (select count(*) from vessl.products)             as now_products,
         (select count(*) from vessl.companies)            as now_companies,
         (select count(*) from vessl.quotes)               as now_quotes,
         (select count(*) from vessl.purchase_order_items) as now_poi,
         (select count(*) from vessl.sales_order_items)    as now_soi,
         (select count(*) from vessl.programs)             as now_programs,
         b.base_products, b.base_true, b.base_false, b.base_null, b.base_noclient,
         b.base_collision, b.base_companies, b.base_quotes, b.base_poi, b.base_soi,
         b.base_programs, b.others_stamp
    from t_base b
)
select * from (
  select 'a0 nine sheet rows were selected, before any write' as chk,
         (select n_rows::text from _pre59) as got, '9' as want
  union all
  select 'a1 five client companies matched by id and name length',
         (select companies_ok::text from _pre59), '5'
  union all
  -- Read from the baseline, so it says the name was free BEFORE the rename rather
  -- than after, when the renamed row would answer for itself.
  select 'a2 the new name was free on that SKU beforehand',
         (select base_collision::text from _pre59), '0'
  union all
  select 'b1 all nine rows now carry the client the sheet named',
         (select client_landed::text from _pre59), '9'
  union all
  select 'b2 the two rows marked Active now read true',
         (select active_landed::text from _pre59), '2'
  union all
  select 'b3 LL1-1591 carries the new name, eighteen characters',
         (select renamed::text from _pre59), '1'
  union all
  select 'b4 LL1-1591 active is now not recorded',
         (select renamed_notset::text from _pre59), '1'
  union all
  select 'b5 both siblings keep their names and stay inactive',
         (select siblings_held::text from _pre59), '2'
  union all
  select 'b6 active true moved by exactly plus two',
         (select (now_true = base_true + 2)::text from _pre59), 'true'
  union all
  select 'b7 active false moved by exactly minus one',
         (select (now_false = base_false - 1)::text from _pre59), 'true'
  union all
  -- Two leave NULL for true and one arrives from false, so the net is minus one.
  select 'b8 active null moved by exactly minus one',
         (select (now_null = base_null - 1)::text from _pre59), 'true'
  union all
  select 'b9 products with no client fell by exactly nine',
         (select (now_noclient = base_noclient - 9)::text from _pre59), 'true'
  union all
  -- NOTHING ELSE MOVED. Every product outside the nine keeps its active, its client,
  -- its name and its updated_at exactly, both siblings included.
  select 'b10 no other product changed name, client, active or stamp',
         (select (others_now = others_stamp)::text from _pre59), 'true'
  union all
  select 'c1 product and company row counts unchanged',
         (select (now_products - base_products)::text || '/' || (now_companies - base_companies)::text from _pre59), '0/0'
  union all
  select 'c2 quotes, PO lines, SO lines and programs unchanged',
         (select (now_quotes - base_quotes)::text || '/' || (now_poi - base_poi)::text || '/'
                 || (now_soi - base_soi)::text || '/' || (now_programs - base_programs)::text from _pre59), '0/0/0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
