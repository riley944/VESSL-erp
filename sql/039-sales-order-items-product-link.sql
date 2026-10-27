-- 39 -- link sales_order_items to products, in three independently provable passes.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- NO sales order line links to a product. 0 of 255. The foreign key has always
-- been there and no code path has ever written it, so revenue cannot be attributed
-- to a product by anything but a string. The lifecycle model in docs/PLM.md ends at
-- Delivered for exactly this reason -- Sold is unreachable.
--
-- ── THREE PASSES, AND THEY ARE NOT EQUALLY GOOD ──────────────────────────────
-- Each pass is a separate update with its own checks, so the confidence of each is
-- visible rather than averaged into one number.
--
--   PASS 1, 49 rows. quote_id -> quotes.product_id. EXACT. The line already
--   records which quote it came from and that quote already records its product.
--   No string is compared anywhere in this pass. It is the only pass that would
--   still be right if every SKU in the system were rewritten tomorrow.
--
--   PASS 2, 78 rows. client_sku matches exactly one SELECTABLE product.
--
--   PASS 3, 104 rows. client_sku matches exactly one RETIRED product. Deliberate,
--   and the decision is recorded here because it looks wrong at a glance --
--   RETIREMENT DOES NOT UNSELL HISTORY. These are real past sales of SKUs since
--   taken out of service, mostly by the size-variant merge. Refusing them would
--   leave 41 percent of the table unlinked forever to protect a rule that is about
--   NEW work. The inactive rule shipped on 2026-09-09 says the same thing -- it
--   blocks new quotes and new products, and leaves 154 historical quotes editable.
--
-- ── WHAT IS DELIBERATELY NOT TOUCHED, 24 rows ────────────────────────────────
--   19  sku matches SEVERAL retired products -- which one sold is a decision
--    1  sku matches SEVERAL selectable products -- same
--    4  sku matches no product at all
-- 49 + 78 + 104 + 24 = 255. c1 proves the four buckets PARTITION the unlinked
-- set -- it counts rows none of them covers, rather than adding up numbers this
-- file typed.
--
-- ── WHAT IS NOT WRITTEN ──────────────────────────────────────────────────────
-- description and client_sku are SNAPSHOTS of an issued sales order and are never
-- touched. b7 and b8 prove it. Nothing on sales_orders is touched either. The only
-- column this script writes anywhere is sales_order_items.product_id, and only
-- where it is currently NULL.
--
-- No trigger is added. purchase_order_items has one that stamps a sku FROM a
-- product; the reverse -- inferring a product from a string -- is a guess, and a
-- trigger is the wrong place to guess. Future rows are handled in code, at the two
-- places that already know the answer.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- 255 sales_order_items, 0 with product_id. 51 carry quote_id and 49 of those
-- reach a product through it. Pass sizes 49 / 78 / 104, untouched 24.
-- 331 quotes, 328 product-linked. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, before any write.
create temp table _pre39 on commit drop as
  select (select count(*) from vessl.sales_order_items)                          as rows_before,
         (select count(*) from vessl.sales_order_items where product_id is null) as unlinked_before,
         (select count(*) from vessl.sales_orders)                               as orders_before;

-- Identity snapshot of every line, so b7 and b8 can prove the two snapshot
-- columns came through untouched.
create temp table _b39 on commit drop as
  select id, product_id, client_sku, description, length(coalesce(description,'')) as desc_len
    from vessl.sales_order_items;

-- The three target sets, resolved ONCE and frozen, so each pass updates exactly
-- the rows it was measured against and a row cannot drift between passes as the
-- earlier ones write.
create temp table _t39 on commit drop as
  with unl as (
    select s.id, s.client_sku,
           (select q.product_id from vessl.quotes q where q.id = s.quote_id) as via_quote
      from vessl.sales_order_items s
     where s.product_id is null)
  select u.id,
         u.via_quote,
         (select p.id from vessl.products p
           where p.active is distinct from false
             and lower(btrim(p.sku)) = lower(btrim(u.client_sku))
           limit 1)                                                              as one_selectable,
         (select count(*) from vessl.products p
           where p.active is distinct from false
             and lower(btrim(p.sku)) = lower(btrim(u.client_sku)))               as sel_n,
         (select p.id from vessl.products p
           where p.active = false
             and lower(btrim(p.sku)) = lower(btrim(u.client_sku))
           limit 1)                                                              as one_retired,
         (select count(*) from vessl.products p
           where p.active = false
             and lower(btrim(p.sku)) = lower(btrim(u.client_sku)))               as ret_n
    from unl u;

-- PASS 1 -- exact, via the quote the line already points at.
update vessl.sales_order_items s
   set product_id = t.via_quote
  from _t39 t
 where s.id = t.id and s.product_id is null
   and t.via_quote is not null;

-- PASS 2 -- exactly one selectable product carries that sku.
update vessl.sales_order_items s
   set product_id = t.one_selectable
  from _t39 t
 where s.id = t.id and s.product_id is null
   and t.via_quote is null and t.sel_n = 1;

-- PASS 3 -- exactly one retired product carries it. History, not new work.
update vessl.sales_order_items s
   set product_id = t.one_retired
  from _t39 t
 where s.id = t.id and s.product_id is null
   and t.via_quote is null and t.sel_n = 0 and t.ret_n = 1;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 no sales order line was linked before this script' as chk,
         (select (rows_before - unlinked_before)::text from _pre39) as got, '0' as want
  union all
  select 'a1 the three target sets sized 49, 78 and 104',
         (select count(*) filter (where via_quote is not null)::text || '/' ||
                 count(*) filter (where via_quote is null and sel_n = 1)::text || '/' ||
                 count(*) filter (where via_quote is null and sel_n = 0 and ret_n = 1)::text
            from _t39), '49/78/104'
  union all
  -- EACH PASS PROVEN SEPARATELY. A single total would hide one pass over-reaching
  -- into another pass rows.
  select 'b1 pass 1 linked its 49, every one to its quote product',
         (select count(*)::text from vessl.sales_order_items s join _t39 t on t.id = s.id
           where t.via_quote is not null and s.product_id = t.via_quote), '49'
  union all
  select 'b2 pass 2 linked its 78, every one to the selectable match',
         (select count(*)::text from vessl.sales_order_items s join _t39 t on t.id = s.id
           where t.via_quote is null and t.sel_n = 1 and s.product_id = t.one_selectable), '78'
  union all
  select 'b3 pass 3 linked its 104, every one to the retired match',
         (select count(*)::text from vessl.sales_order_items s join _t39 t on t.id = s.id
           where t.via_quote is null and t.sel_n = 0 and t.ret_n = 1
             and s.product_id = t.one_retired), '104'
  union all
  -- THE 24 THAT ARE DECISIONS, asserted as still NULL rather than assumed.
  select 'b4 the ambiguous and unmatched 24 are still unlinked',
         (select count(*)::text from vessl.sales_order_items s join _t39 t on t.id = s.id
           where s.product_id is null
             and (t.via_quote is null and (t.sel_n > 1 or (t.sel_n = 0 and t.ret_n <> 1)))), '24'
  union all
  select 'b5 231 linked in total, and nothing else moved',
         (select count(*)::text from vessl.sales_order_items where product_id is not null), '231'
  union all
  select 'b6 every product_id written points at a real product',
         (select count(*)::text from vessl.sales_order_items s
           where s.product_id is not null
             and not exists (select 1 from vessl.products p where p.id = s.product_id)), '0'
  union all
  -- THE SNAPSHOT COLUMNS. These print on an issued sales order and this script has
  -- no business touching either.
  select 'b7 no client_sku changed',
         (select count(*)::text from _b39 b join vessl.sales_order_items s on s.id = b.id
           where s.client_sku is not distinct from b.client_sku), '255'
  union all
  select 'b8 no description changed',
         (select count(*)::text from _b39 b join vessl.sales_order_items s on s.id = b.id
           where s.description is not distinct from b.description
             and length(coalesce(s.description,'')) = b.desc_len), '255'
  union all
  -- A REAL PARTITION CHECK, not arithmetic. The first draft of this read
  -- (49 + 78 + 104 + 24) and compared it to 255, which is a sum of numbers this
  -- file typed and proves nothing about the table. This counts rows the four
  -- buckets do NOT cover, which is the claim actually being made.
  select 'c1 the four buckets cover every unlinked row, none left over',
         (select (count(*)
                - count(*) filter (where via_quote is not null)
                - count(*) filter (where via_quote is null and sel_n = 1)
                - count(*) filter (where via_quote is null and sel_n = 0 and ret_n = 1)
                - count(*) filter (where via_quote is null
                                     and (sel_n > 1 or (sel_n = 0 and ret_n <> 1))))::text
            from _t39), '0'
  union all
  select 'c2 row count unchanged, before and after',
         (select ((select count(*) from vessl.sales_order_items) - (select rows_before from _pre39))::text), '0'
  union all
  select 'c3 no sales order row created or deleted',
         (select ((select count(*) from vessl.sales_orders) - (select orders_before from _pre39))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
