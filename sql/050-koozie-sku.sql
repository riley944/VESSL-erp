-- 50 -- the Koozie gets its SKU. Finishing what Kristy started.
--
-- Product 78dffbc0, Koozie with magnet, has carried sku NULL since it was
-- created. It is the last of the product-identity questions from the 2026-09-08
-- duplicate census, and the only one still open.
--
-- ── THE QUOTE ALREADY SAYS STC-016 ──────────────────────────────────────────
-- Kristy set it on Thursday 10 September at 15.55 local. The quote row saved --
-- quotes.sku reads STC-016 and updated_by reads her address -- and then the
-- follow-on rename flow died against a table script 48 had renamed eight minutes
-- earlier. See the CATALOGUE entry.
--
-- So this script writes ONE column. The quote needs nothing; b3 asserts it still
-- reads what she typed rather than assuming.
--
-- ── WHY NOT THE RENAME SKU MODAL ────────────────────────────────────────────
-- Its guard handles a null old SKU correctly -- rename_product_sku compares with
-- is distinct from, so null against null passes.
--
-- THE FUNCTION ITSELF IS BROKEN. It still reads vessl.programs.sku and
-- vessl.programs.quote_sku in three statements, and script 48 replaced that
-- table with one that has neither column. Every rename now fails at plan time
-- with 42703, whatever SKU it starts from. That needs its own script; this one
-- does not wait for it.
--
-- ── STC-016 IS FREE ─────────────────────────────────────────────────────────
-- 0 products, 0 quotes other than this one, 0 purchase order lines, 0 sales
-- order lines. STC-002 and STC-017 exist, so the number sits inside a real
-- series with the neighbours either side of it taken.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- The product is active, name 18 characters, sku NULL, and carries 1 quote, 1
-- program, 0 purchase order lines and 0 sales order lines. The quote is
-- 053c300e and its sku is already the 7 characters STC-016. Rehearsal z0,
-- commit z0.

begin;

create temp table _pre50 on commit drop as
  select (select count(*) from vessl.products)                                  as rows_before,
         (select count(*) from vessl.products where sku is null)                as nullsku_before,
         (select count(*) from vessl.products where active is distinct from false) as selectable_before;

create temp table _b50 on commit drop as
  select p.id, p.sku, p.name, p.active, length(p.name) as n_len
    from vessl.products p where p.id = '78dffbc0-bed4-45b0-85dd-01c79e582989'::uuid;

-- Guarded on the sku STILL being null and on the raw name length, so a row
-- somebody has already named or renamed is left alone and fails a0 loudly.
update vessl.products p
   set sku = 'STC-016', updated_at = now()
 where p.id = '78dffbc0-bed4-45b0-85dd-01c79e582989'::uuid
   and p.sku is null
   and length(p.name) = 18;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the product had no sku, at its exact name length' as chk,
         (select count(*)::text from _b50 where sku is null and n_len = 18) as got, '1' as want
  union all
  select 'a1 and it is selectable',
         (select count(*)::text from _b50 where active is distinct from false), '1'
  union all
  -- STC-016 FREE EVERYWHERE, checked case and space insensitively.
  select 'a2 no other product holds STC-016',
         (select count(*)::text from vessl.products
           where upper(replace(btrim(coalesce(sku,'')),' ','')) = 'STC-016'
             and id is distinct from '78dffbc0-bed4-45b0-85dd-01c79e582989'::uuid), '0'
  union all
  select 'a3 nor any purchase order or sales order line',
         (select ((select count(*) from vessl.purchase_order_items
                    where upper(replace(btrim(coalesce(product_sku,'')),' ','')) = 'STC-016')
                + (select count(*) from vessl.sales_order_items
                    where upper(replace(btrim(coalesce(client_sku,'')),' ','')) = 'STC-016'))::text), '0'
  union all
  select 'b1 the product now reads STC-016',
         (select sku::text from vessl.products
           where id = '78dffbc0-bed4-45b0-85dd-01c79e582989'::uuid), 'STC-016'
  union all
  select 'b2 and its name is untouched',
         (select count(*)::text from _b50 b join vessl.products p on p.id = b.id
           where p.name is not distinct from b.name), '1'
  union all
  -- THE QUOTE KRISTY ALREADY SAVED. This script must not need to touch it, and
  -- must not have touched it.
  select 'b3 the quote still reads what she typed',
         (select q.sku::text from vessl.quotes q
           where q.id = '053c300e-ef83-4624-ba59-015436873290'::uuid), 'STC-016'
  union all
  select 'b4 and product and quote now agree',
         (select (p.sku = q.sku)::text from vessl.products p, vessl.quotes q
           where p.id = '78dffbc0-bed4-45b0-85dd-01c79e582989'::uuid
             and q.id = '053c300e-ef83-4624-ba59-015436873290'::uuid), 'true'
  union all
  select 'c1 one fewer product without a sku',
         (select ((select nullsku_before from _pre50)
                - (select count(*) from vessl.products where sku is null))::text), '1'
  union all
  select 'c2 no product created, deleted or retired',
         (select ((select count(*) from vessl.products) - (select rows_before from _pre50))::text || ' and ' ||
                 ((select count(*) from vessl.products where active is distinct from false)
                - (select selectable_before from _pre50))::text), '0 and 0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
