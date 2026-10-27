-- 38 -- retire the BG09RL-EXW orphan, which the interface cannot reach.
--
-- ── WHY A SCRIPT FOR ONE ROW ─────────────────────────────────────────────────
-- 54dff5d7 is a duplicate BG09RL-EXW carrying nothing at all -- no quote, no
-- purchase order line, no regulation or material link, no test report, no
-- compliance task, no inventory row of any kind. All ten tables holding a
-- product_id were checked, not the two that were top of mind.
--
-- It was going to be retired by hand, and it cannot be. THE PRODUCTS PAGE
-- RENDERS FROM QUOTES, not from products -- it loads quotes and maps each to a
-- product through matchOf -- so a product with no quote has no row to click and
-- no dropdown to change. Searching BG09RL shows the four rows that have quotes
-- and not this one. The only way to change it is here.
--
-- That is a general gap rather than a quirk of this row, and it is bigger than
-- one product. MEASURED WHILE WRITING THIS -- 27 products have no quote at all,
-- and 23 of those are selectable. One of the 23 even sits on a purchase order.
-- All 23 are invisible on the Products page while remaining eligible for SKU
-- matching. Recorded in docs/CATALOGUE.md rather than fixed here; a script that
-- retired all 23 would be deciding something nobody has decided.
--
-- ── WHAT IT DOES ─────────────────────────────────────────────────────────────
-- One guarded update. Keyed on id, refusing to run unless the row is still
-- selectable, and asserting the row is unreferenced BEFORE the write as well as
-- after -- a0 reads the pre-state snapshot, b2 reads live. If anything has come
-- to point at it since this was written, a1 fails and nothing is committed.
--
-- Its sibling a3736ce9, the real BG09RL-EXW carrying the quote and the purchase
-- order line, is asserted untouched by b3. That is the row this must not hit.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- 350 products, 185 selectable, 165 retired, after script 37 committed. Row
-- 54dff5d7 reads sku BG09RL-EXW, name 9 Hole Set (1 Right, 1 Left Club) at 33
-- characters, active not set, and zero references across all ten product_id
-- tables. Three duplicate sku groups remain among selectable products and this
-- resolves one of them, leaving BUC-157 KU2607001 and LL1-1618 -- both decisions
-- for Kristy rather than cleanups. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, before the write, so the counts below describe this script.
create temp table _pre38 on commit drop as
  select (select count(*) from vessl.products where active is distinct from false) as selectable_before,
         (select count(*) from vessl.products)                                     as products_before,
         (select count(*) from (
            select lower(btrim(sku)) k from vessl.products
             where active is distinct from false and sku is not null and btrim(sku) <> ''
             group by 1 having count(*) > 1) z)                                    as dup_groups_before;

-- Identity snapshot plus every reference count, taken before anything is written.
create temp table _b38 on commit drop as
  select p.id, p.sku, p.name, length(p.name) as name_len, p.active,
         (select count(*) from vessl.quotes q               where q.product_id  = p.id) +
         (select count(*) from vessl.purchase_order_items i where i.product_id  = p.id) +
         (select count(*) from vessl.sales_order_items s    where s.product_id  = p.id) +
         (select count(*) from vessl.product_regulations r  where r.product_id  = p.id) +
         (select count(*) from vessl.product_materials m    where m.product_id  = p.id) +
         (select count(*) from vessl.test_reports t         where t.product_id  = p.id) +
         (select count(*) from vessl.compliance_tasks ct    where ct.product_id = p.id) +
         (select count(*) from vessl.inventory_balances ib  where ib.product_id = p.id) +
         (select count(*) from vessl.inventory_lots il      where il.product_id = p.id) +
         (select count(*) from vessl.stock_movements sm     where sm.product_id = p.id) as refs
    from vessl.products p
   where p.id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid;

-- THE WRITE. Keyed on id, guarded on still-selectable so a row already retired
-- is skipped and fails b1 loudly rather than being written over, and guarded on
-- the raw name length so a row whose name has changed since this was measured is
-- left alone.
update vessl.products p
   set active = false
 where p.id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid
   and p.active is distinct from false
   and length(p.name) = 33;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the row existed, selectable, at its exact raw name length' as chk,
         (select count(*)::text from _b38
           where active is distinct from false and name_len = 33 and sku = 'BG09RL-EXW') as got,
         '1' as want
  union all
  -- THE GUARD THAT MATTERS. Retiring a referenced row is the one way this could
  -- do harm, so the count is taken across all ten product_id tables before the
  -- write rather than the two that come to mind.
  select 'a1 nothing referenced it before the write',
         (select refs::text from _b38), '0'
  union all
  select 'b1 it is retired now',
         (select count(*)::text from vessl.products
           where id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid and active = false), '1'
  union all
  select 'b2 and nothing references it after the write either',
         (select (
            (select count(*) from vessl.quotes q               where q.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.purchase_order_items i where i.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.sales_order_items s    where s.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.product_regulations r  where r.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.product_materials m    where m.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.test_reports t         where t.product_id  = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.compliance_tasks ct    where ct.product_id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.inventory_balances ib  where ib.product_id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.inventory_lots il      where il.product_id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid) +
            (select count(*) from vessl.stock_movements sm     where sm.product_id = '54dff5d7-9d3e-4fca-b31e-589574fe8f6a'::uuid)
          )::text), '0'
  union all
  -- THE SIBLING THIS MUST NOT HIT. The real BG09RL-EXW, still selectable, still
  -- carrying its quote and its purchase order line.
  select 'b3 the sibling is untouched, active with its quote and po line',
         (select p.active::text || '/' ||
                 (select count(*) from vessl.quotes q where q.product_id = p.id)::text || '/' ||
                 (select count(*) from vessl.purchase_order_items i where i.product_id = p.id)::text
            from vessl.products p
           where p.id = 'a3736ce9-d0b9-4582-83a9-0308204fa9fa'::uuid), 'true/1/1'
  union all
  select 'c1 selectable products down by exactly one',
         (select ((select selectable_before from _pre38)
                - (select count(*) from vessl.products where active is distinct from false))::text), '1'
  union all
  select 'c2 duplicate sku groups down by exactly one',
         (select ((select dup_groups_before from _pre38)
                - (select count(*) from (
                     select lower(btrim(sku)) k from vessl.products
                      where active is distinct from false and sku is not null and btrim(sku) <> ''
                      group by 1 having count(*) > 1) z))::text), '1'
  union all
  select 'c3 no product row created or deleted',
         (select ((select count(*) from vessl.products) - (select products_before from _pre38))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
