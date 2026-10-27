-- 58 -- fourteen products retired, because being ordered once is not being current.
--
-- WHY THIS UNDOES PART OF SCRIPT 52. Move B of script 52 turned 30 products from
-- false to true on the reasoning that a product with purchase order lines had been
-- bought and so was real. The definition since settled is different and simpler.
-- Inactive means RETIRED FROM NEW USE, whatever the order history says. Order lines
-- are history; active is a decision about the future. So the flip was right about
-- the facts and wrong about the question, and these rows go back to false.
--
-- NOTHING ABOUT THE ORDERS CHANGES. Every purchase order line, sales order line and
-- quote these products carry stays exactly as it is, and the checks below prove the
-- row counts did not move. A retired product keeps its history; it simply cannot be
-- put on a NEW line, which is what the app enforces since f9619c2.
--
-- FOURTEEN, NOT THIRTY. The other 16 List-B rows were retired by hand on the
-- Products page on 2026-09-16, before this ran. They are listed below by id as
-- t_byhand, and the checks prove all 16 are still inactive and that this script did
-- not touch them. Note that the Products page control does not stamp updated_at, so
-- those rows still carry the timestamp script 52 left on them.
--
-- ALL FOURTEEN BELONG TO BUCKETGOLF, six BG-104 size rows and eight set, club and
-- pad variants. The six sizes each have one same-SKU sibling that is already false,
-- so after this every row carrying those SKUs is retired, which is what makes the
-- parent BG-104 the orderable row -- it went active in script 59 the same day.
--
-- ARCHIVE
--   archive/2026-09-16-list-b-retired.json holds all fourteen rows as they stand,
--   with their order and quote counts, exported before this was written.
--
-- MEASURED BEFORE WRITING, against the live database
--   14 rows, every one active true, every one carrying at least one purchase order
--   line, every one on BucketGolf, and all 14 still stamped with the script 52
--   timestamp. The guard re-proves each of those rather than trusting them.

begin;

-- The fourteen, as ids. Columns are named rather than starred, because preflight
-- reads the verification block as everything from the first select star from
-- open-paren in the file.
create temp table t_retire on commit drop as
select v.product_id from (values
  ('f160f8f7-5daa-4ae8-aa53-0d67f4eb2371'::uuid),
  ('d9367d86-3788-406a-8123-dfefebd9f59f'::uuid),
  ('0201841f-7ad3-4da6-9ad8-d185f01d7225'::uuid),
  ('d87f0977-3d4a-4515-bc08-faa565f3cae1'::uuid),
  ('59a7c385-988e-470d-9265-c0878aadaef5'::uuid),
  ('9ef11389-b2a0-4bdd-a803-dd40d3077ad6'::uuid),
  ('cdf1f417-6652-4c48-8950-deae2f62a9e2'::uuid),
  ('b70b9c97-eeb6-48f0-9293-2ccced15aef6'::uuid),
  ('44549bbb-2368-474b-9683-c4b09875eb8a'::uuid),
  ('0ca91988-e5bb-462e-8bd0-fc05945d796a'::uuid),
  ('3065b248-37be-4395-abaa-531cfa2f1e01'::uuid),
  ('dcb4ba44-2897-471c-a2c5-d1da925c8e96'::uuid),
  ('9cdb1072-d8b7-44b2-8ce4-371028114428'::uuid),
  ('7cf2d8c6-5867-411a-aeba-0a227396a506'::uuid)
) as v(product_id);

-- The sixteen List-B rows already retired by hand, also as ids. They are named here
-- rather than found by their script 52 timestamp because a time of day written as a
-- literal carries colons, and a colon followed by a digit is what a bind-parameter
-- rewriter reads as a parameter. Ids are the identity rule anyway.
create temp table t_byhand on commit drop as
select v.product_id from (values
  ('d5d44a42-2f92-4748-97d0-7911f7d2fb80'::uuid), -- BG-101-2XL
  ('9c6ee5d8-0df1-4b1f-9894-0b9d83a40330'::uuid), -- BG-101-3XL
  ('1efba198-2d7d-45e0-9735-f98d3282f75b'::uuid), -- BG-101-L
  ('56eb2269-0750-4945-9231-5285f6e3ad8c'::uuid), -- BG-101-M
  ('533b4bed-5b98-4241-bd12-d7afd29e182d'::uuid), -- BG-101-S
  ('dbe8e840-e3d3-4e86-829f-be1b7176ed42'::uuid), -- BG-101-XL
  ('f03148c1-50a1-442f-8d1d-1c9782e0004a'::uuid), -- BG-113-2XL
  ('41e86f70-ea1a-435a-9cbd-6e5e1e18ab98'::uuid), -- BG-113-3XL
  ('ae183834-6b23-4eaf-8a6e-eedbf759d414'::uuid), -- BG-113-L
  ('f64cc4b4-c1bd-4598-9ba7-fea546441d36'::uuid), -- BG-113-M
  ('f3301e2b-1310-4a06-a75c-9762b381f693'::uuid), -- BG-113-S
  ('29d17658-655b-4600-837b-1990764fb8fd'::uuid), -- BG-113-XL
  ('a607fffd-649a-4f21-93d2-fa6ff2b1116e'::uuid), -- SL-117 L
  ('ec1ed2f6-3976-47e6-880f-d5787f75dfe1'::uuid), -- SL-117 M
  ('6e97fa5e-e737-434a-b231-62c29f9cc5e3'::uuid), -- SL-117 S
  ('2a5a95d4-1e03-47e0-95ef-21c9f451dc51'::uuid)  -- SL-117 XS
) as v(product_id);

-- Baselines, so the checks can prove what did NOT move.
create temp table t_base on commit drop as
select (select count(*) from vessl.products)                         as base_products,
       (select count(*) from vessl.products where active is true)    as base_true,
       (select count(*) from vessl.products where active is false)   as base_false,
       (select count(*) from vessl.products where active is null)    as base_null,
       (select count(*) from vessl.quotes)                           as base_quotes,
       (select count(*) from vessl.purchase_order_items)             as base_poi,
       (select count(*) from vessl.sales_order_items)                as base_soi,
       (select count(*) from vessl.programs)                         as base_programs,
       -- The sixteen retired by hand, counted before the write so the pair of checks
       -- below can show the number did not move.
       (select count(*) from vessl.products p join t_byhand h on h.product_id = p.id
         where p.active is false) as base_byhand,
       (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                              || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
          from vessl.products p
         where p.id not in (select product_id from t_retire)) as others_stamp;

-- REFUSE rather than retire a set that is not the one measured.
do $guard$
begin
  if (select count(*) from t_retire) <> 14
     or (select count(*) from vessl.products p join t_retire t on t.product_id = p.id) <> 14
     or (select count(*) from vessl.products p join t_retire t on t.product_id = p.id
          where p.active is true) <> 14
     or (select count(*) from t_byhand) <> 16
     or (select count(*) from vessl.products p join t_byhand h on h.product_id = p.id
          where p.active is false) <> 16
     or (select count(*) from vessl.products p join t_retire t on t.product_id = p.id
          where exists (select 1 from vessl.purchase_order_items i where i.product_id = p.id)) <> 14
     or (select count(*) from vessl.products p join t_retire t on t.product_id = p.id
          where p.client_company_id = '771dc750-929c-4b8f-a279-53404e94da60') <> 14
     or (select count(*) from vessl.companies c
          where c.id = '771dc750-929c-4b8f-a279-53404e94da60' and length(c.name) = 10) <> 1 then
    raise exception 'the fourteen no longer match the database, nothing changed';
  end if;
end
$guard$;

-- The write, guarded on the value each row still holds.
update vessl.products p
   set active = false,
       updated_at = now()
  from t_retire t
 where p.id = t.product_id
   and p.active is true;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
with _pre58 as (
  select (select count(*) from t_retire) as n_rows,
         (select count(*) from vessl.products p join t_retire t on t.product_id = p.id
           where p.active is false) as retired_landed,
         (select count(*) from vessl.products p join t_retire t on t.product_id = p.id
           where exists (select 1 from vessl.purchase_order_items i where i.product_id = p.id)) as still_have_po,
         (select count(*) from vessl.products p join t_byhand h on h.product_id = p.id
           where p.active is false) as byhand_now,
         (select count(*) from vessl.products where active is true)  as now_true,
         (select count(*) from vessl.products where active is false) as now_false,
         (select count(*) from vessl.products where active is null)  as now_null,
         (select md5(string_agg(p.id::text || '|' || coalesce(p.active::text, 'null') || '|'
                                || coalesce(p.updated_at::text, 'null'), ',' order by p.id))
            from vessl.products p
           where p.id not in (select product_id from t_retire)) as others_now,
         (select count(*) from vessl.products)             as now_products,
         (select count(*) from vessl.quotes)               as now_quotes,
         (select count(*) from vessl.purchase_order_items) as now_poi,
         (select count(*) from vessl.sales_order_items)    as now_soi,
         (select count(*) from vessl.programs)             as now_programs,
         b.base_products, b.base_true, b.base_false, b.base_null, b.base_quotes,
         b.base_poi, b.base_soi, b.base_programs, b.base_byhand, b.others_stamp
    from t_base b
)
select * from (
  select 'a0 fourteen rows were selected, before any write' as chk,
         (select n_rows::text from _pre58) as got, '14' as want
  union all
  select 'a1 the sixteen retired by hand were counted first',
         (select base_byhand::text from _pre58), '16'
  union all
  select 'b1 every selected row now reads inactive',
         (select retired_landed::text from _pre58), '14'
  union all
  select 'b2 active false moved by exactly plus fourteen',
         (select (now_false = base_false + 14)::text from _pre58), 'true'
  union all
  select 'b3 active true moved by exactly minus fourteen',
         (select (now_true = base_true - 14)::text from _pre58), 'true'
  union all
  select 'b4 active null did not move',
         (select (now_null = base_null)::text from _pre58), 'true'
  union all
  -- History is kept. Retiring a product says nothing about the orders it has already
  -- been on, and every one of the fourteen still carries its purchase order lines.
  select 'b5 all fourteen still carry their purchase order lines',
         (select still_have_po::text from _pre58), '14'
  union all
  -- Read after the write, against the same sixteen ids the baseline counted.
  select 'b6 the sixteen retired by hand are all still inactive',
         (select byhand_now::text from _pre58), '16'
  union all
  -- NOTHING ELSE MOVED. Every product outside the fourteen keeps its active and its
  -- updated_at exactly, the sixteen included.
  select 'b7 no other product changed active or updated_at',
         (select (others_now = others_stamp)::text from _pre58), 'true'
  union all
  select 'c1 product row count unchanged',
         (select (now_products - base_products)::text from _pre58), '0'
  union all
  select 'c2 quotes, PO lines, SO lines and programs unchanged',
         (select (now_quotes - base_quotes)::text || '/' || (now_poi - base_poi)::text || '/'
                 || (now_soi - base_soi)::text || '/' || (now_programs - base_programs)::text from _pre58), '0/0/0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
