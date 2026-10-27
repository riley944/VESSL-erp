-- 37 AFTER COMMIT -- run in a FRESH TAB, after script 37 has been committed.
--
-- Nothing here is expected to fail. It is a second look from outside the
-- transaction that made the changes.

-- 1. The four pairs, as they now stand. Expect eight rows -- four survivors with
--    clean names, still selectable, each carrying two quotes and one purchase
--    order line, and four retired rows carrying nothing at all.
select p.sku,
       left(p.id::text, 8) as id8,
       p.name,
       length(p.name) as name_len,
       coalesce(p.active::text, 'not set') as active,
       (select count(*) from vessl.quotes q where q.product_id = p.id) as quotes,
       (select count(*) from vessl.purchase_order_items i where i.product_id = p.id) as po_items
  from vessl.products p
 where p.sku in ('LL1-1212', 'LL1-1213', 'LL1-1214', 'LLF-1617')
 order by p.sku, p.active nulls first;

-- 2. What remains duplicated among selectable products. Expect BG09RL-EXW only
--    if it has not yet been retired by hand, plus BUC-157 KU2607001 and LL1-1618
--    -- the two that are decisions for Kristy rather than cleanups.
select lower(btrim(p.sku)) as sku_key, count(*) as rows
  from vessl.products p
 where p.active is distinct from false and p.sku is not null and btrim(p.sku) <> ''
 group by 1 having count(*) > 1
 order by 1;

-- 3. Totals. Expect four fewer selectable than the 189 measured before this
--    script, less one more if the BG09RL-EXW orphan was retired by hand.
select count(*) as total_products,
       count(*) filter (where active is distinct from false) as selectable,
       count(*) filter (where active = false) as retired
  from vessl.products;

-- 4. No purchase order line moved. Expect four rows, each still pointing at its
--    survivor, and each product_sku matching that survivor current sku.
select left(i.id::text, 8) as line_id8,
       left(i.product_id::text, 8) as points_at,
       i.product_sku,
       p.sku as survivor_sku,
       (i.product_sku = p.sku) as sku_matches
  from vessl.purchase_order_items i
  join vessl.products p on p.id = i.product_id
 where p.sku in ('LL1-1212', 'LL1-1213', 'LL1-1214', 'LLF-1617')
 order by p.sku;
