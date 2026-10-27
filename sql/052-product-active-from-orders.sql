-- 52-product-active-from-orders.sql
--
-- Kristy: a product is not really active until somebody has bought it.
--
-- This is a ONE-TIME RECONCILIATION of the manual flag against what the orders
-- actually say. It does NOT redefine active, and nothing after this derives the
-- flag -- active keeps meaning "a person decided this is in service", and the
-- derived ordered marker that follows in the UI is a separate signal beside it.
--
-- TWO MOVES:
--   A. 45 rows active = true with NO purchase order line  -> NULL (not recorded)
--   B. 30 rows active = false WITH purchase order lines   -> true
--
-- B IS AN UN-RETIREMENT and that is the point of it, but it is worth being
-- deliberate: these rows become selectable again in quote save, the CPSC
-- matcher, the Testing pickers, and they will appear on the PLM board. That door
-- is being opened on purpose, on Kristy word, not as a side effect.
--
-- WHAT IS HELD BACK. Two rows that qualify for B are deliberately left false:
-- both are LL1-380, and a third row carrying that same SKU is already active. A
-- flip would leave three active products sharing one SKU, which breaks the
-- assumption skuActivity and ensureProductForQuote rely on -- that "every row
-- with this SKU is retired" is a usable test -- and would offer three
-- identical-SKU choices in every picker. Those two belong to the twins and sizes
-- cleanup, not here.
--
-- The hold rule is written as a predicate rather than as an id list so it cannot
-- disagree with itself: a row is held when ANY OTHER row sharing its SKU would
-- be non-false afterwards. That includes rows which are true or NULL today, and
-- it includes other candidates of move B -- which is what makes the two LL1-380
-- rows hold each other rather than one of them slipping through.

begin;

-- ── The two target sets, captured BEFORE anything is written ────────────────
-- Captured as ids, so the updates below cannot re-evaluate a predicate against
-- rows this transaction has already changed.
create temp table t_to_null on commit drop as
select pr.id
  from vessl.products pr
 where pr.active is true
   and not exists (select 1 from vessl.purchase_order_items poi
                    where poi.product_id = pr.id);

create temp table t_to_true on commit drop as
select pr.id
  from vessl.products pr
 where pr.active is false
   and exists (select 1 from vessl.purchase_order_items poi
                where poi.product_id = pr.id)
   and not exists (
         select 1
           from vessl.products o
          where o.sku = pr.sku
            and o.id <> pr.id
            and ( o.active is not false
               or exists (select 1 from vessl.purchase_order_items p2
                           where p2.product_id = o.id) ) );

-- ── Baselines, so the checks can prove what did NOT move ───────────────────
-- Named base_ throughout. An earlier draft reused the live names here, which
-- made "products = products" compare a column to itself and pass whatever
-- happened -- a check that cannot fail is worse than no check.
create temp table t_base on commit drop as
select (select count(*) from vessl.quotes)               as base_quotes,
       (select count(*) from vessl.purchase_order_items) as base_poi,
       (select count(*) from vessl.sales_order_items)    as base_soi,
       (select count(*) from vessl.test_reports)         as base_reports,
       (select count(*) from vessl.products)             as base_products,
       (select count(*) from vessl.products where active is true)  as base_true,
       (select count(*) from vessl.products where active is false) as base_false,
       (select count(*) from vessl.products where active is null)  as base_null;

-- ── The writes, guarded on the value each row still holds ──────────────────
-- The active test repeats here on purpose. The temp table says which rows were
-- chosen; the guard says the row has not moved since, so a concurrent edit is
-- skipped rather than overwritten.
update vessl.products p
   set active = null,
       updated_at = now()
  from t_to_null t
 where p.id = t.id
   and p.active is true;

update vessl.products p
   set active = true,
       updated_at = now()
  from t_to_true t
 where p.id = t.id
   and p.active is false;

-- ── One combined verification ──────────────────────────────────────────────
-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
--
-- The baselines are named base_ and the live reads now_. An earlier draft gave
-- both the same names, which made "products = products" compare a column to
-- itself and pass whatever happened. A check that cannot fail is worse than no
-- check, because it reads like one.
with _pre52 as (
  select (select count(*) from t_to_null) as n_null_targets,
         (select count(*) from t_to_true) as n_true_targets,
         (select count(*) from vessl.products p join t_to_null t on t.id = p.id
           where p.active is null) as null_landed,
         (select count(*) from vessl.products p join t_to_true t on t.id = p.id
           where p.active is true) as true_landed,
         (select count(*) from vessl.products where active is true)  as now_true,
         (select count(*) from vessl.products where active is false) as now_false,
         (select count(*) from vessl.products where active is null)  as now_null,
         (select count(*) from vessl.products p
           where p.active is false
             and exists (select 1 from vessl.purchase_order_items poi
                          where poi.product_id = p.id)) as still_false_with_po,
         (select count(*) from vessl.quotes)               as now_quotes,
         (select count(*) from vessl.purchase_order_items) as now_poi,
         (select count(*) from vessl.sales_order_items)    as now_soi,
         (select count(*) from vessl.test_reports)         as now_reports,
         (select count(*) from vessl.products)             as now_products,
         b.base_quotes, b.base_poi, b.base_soi, b.base_reports,
         b.base_products, b.base_true, b.base_false, b.base_null
    from t_base b
)
select * from (
  select 'a0 45 rows were selected for NULL, before any write' as chk,
         (select n_null_targets::text from _pre52) as got, '45' as want
  union all
  select 'a1 30 rows were selected for true, the other 2 held',
         (select n_true_targets::text from _pre52), '30'
  union all
  select 'b3 every NULL target now reads NULL',
         (select (null_landed = n_null_targets)::text from _pre52), 'true'
  union all
  select 'b4 every true target now reads true',
         (select (true_landed = n_true_targets)::text from _pre52), 'true'
  union all
  -- base_true loses 45 to NULL and gains 30 back from false.
  select 'b5 active true moved by exactly minus 45 plus 30',
         (select (now_true = base_true - 45 + 30)::text from _pre52), 'true'
  union all
  select 'b6 active false moved by exactly minus 30',
         (select (now_false = base_false - 30)::text from _pre52), 'true'
  union all
  select 'b7 active null moved by exactly plus 45',
         (select (now_null = base_null + 45)::text from _pre52), 'true'
  union all
  -- The two LL1-380 rows are the only ordered rows left retired. This asserts
  -- the hold HAPPENED, rather than asserting an absence the script created.
  select 'b8 exactly 2 ordered rows are still false',
         (select still_false_with_po::text from _pre52), '2'
  union all
  select 'b9 product row count unchanged',
         (select (now_products = base_products)::text from _pre52), 'true'
  union all
  select 'c1 quotes row count unchanged',
         (select (now_quotes = base_quotes)::text from _pre52), 'true'
  union all
  select 'c2 purchase order item count unchanged',
         (select (now_poi = base_poi)::text from _pre52), 'true'
  union all
  select 'c3 sales order item count unchanged',
         (select (now_soi = base_soi)::text from _pre52), 'true'
  union all
  select 'c4 test report count unchanged',
         (select (now_reports = base_reports)::text from _pre52), 'true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
