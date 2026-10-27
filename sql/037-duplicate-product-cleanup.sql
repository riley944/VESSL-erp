-- 37 -- four imported-twice product pairs, resolved.
--
-- ── WHAT IT DOES, PER PAIR ───────────────────────────────────────────────────
-- Each of LL1-1212, LL1-1213, LL1-1214 and LLF-1617 exists twice among
-- selectable products. One row of each pair carries the purchase order line AND a
-- quote; the other carries only a quote. For each pair this
--
--   1. deactivates the quote-only row,
--   2. renames the survivor from its padded spreadsheet line to a clean name,
--   3. moves the orphan quote onto the survivor.
--
-- Three duplicate groups are DELIBERATELY LEFT ALONE and are not touched here.
-- BG09RL-EXW is being resolved by hand in the interface. BUC-157 KU2607001 and
-- LL1-1618 are decisions for Kristy rather than cleanups -- BUC-157 because the
-- two rows have split the evidence between them, one holding the purchase order
-- line and the other the quote, and LL1-1618 because its two rows are DIFFERENT
-- PRODUCTS sharing one SKU, a green youth shirt and a pink girls shirt with three
-- regulation links each. Merging that pair would be wrong.
--
-- ── THE REPOINT IS DELIBERATE, AND THE APP REFUSES TO DO IT ──────────────────
-- linkQuoteToProduct in page.jsx updates quotes.product_id only where it IS NULL,
-- with a comment saying an existing link is never re-pointed because that write
-- fires from an Active toggle and a toggle is not a statement about which product
-- a quote belongs to. That guard is right for an implicit write.
--
-- This is an explicit one. Leaving the four orphan quotes pointed at rows this
-- script has just deactivated would make each of them render with a red Inactive
-- dot on the Products page and sort under the Inactive filter -- describing a
-- decision about the product that nobody made about that quote. matchOf reads
-- product_id FIRST and falls back to sku and name, so the stale link wins over the
-- correct fallback. Moving the link is what makes the retirement honest.
--
-- NOTHING A CLIENT SEES CHANGES. printClientSheet prints q.product and q.sku from
-- the quote row itself, and a purchase order line prints product_sku stamped from
-- its own product_id. Neither is read from quotes.product_id, and no purchase
-- order line is touched at all. b3 and b4 assert both.
--
-- ── THE NAMES ────────────────────────────────────────────────────────────────
-- Whitespace collapsed, the Christmsas typo fixed, and the SKU prefix dropped
-- because the SKU has its own column and the hand-typed names in the catalogue
-- already follow that convention. All four measured before printing.
--
--   2b564891  [LL1-1212     Cotton Christmas Bag     Red Reindeer]     50 chars
--          -> [Cotton Christmas Bag Red Reindeer]                      33 chars
--   fd7ef8c7  [LL1-1213     Cotton Christmsas Bag     Green Trees]     50 chars
--          -> [Cotton Christmas Bag Green Trees]                       32 chars
--   0eee867a  [LL1-1214     Cotton Christmas Bag     Blue Snowflake]   52 chars
--          -> [Cotton Christmas Bag Blue Snowflake]                    35 chars
--   0ea36842  [LLF-1617     VIP Drawstring Bag     Black]              41 chars
--          -> [VIP Drawstring Bag Black]                               24 chars
--
-- The new names are written as literals because a SET value has to be, but every
-- one is single-spaced and b2 asserts the RESULTING LENGTH rather than the text,
-- so a paste that ate a character fails loudly instead of storing it.
--
-- ── COUNTS ARE ASSERTED AS DIFFERENCES, NOT ABSOLUTES ────────────────────────
-- Measured now, 189 selectable products and 7 duplicate groups, with the
-- BG09RL-EXW orphan still not set. If that one is deactivated by hand before this
-- runs the numbers become 188 and 6, and after this script 184 and 2 rather than
-- 185 and 3. Both endings are correct and the script cannot know which happened,
-- so c1 and c2 assert that THIS SCRIPT removed exactly four of each. An absolute
-- want would fail a perfectly good run for a reason unrelated to the script.
--
-- After all of it, three duplicate groups remain on paper and only TWO are real
-- questions -- BUC-157 and LL1-1618 -- because BG09RL-EXW is resolved in the
-- interface rather than here.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- 350 products, 189 selectable, 161 retired. The eight rows below are all
-- selectable, the four survivors hold one purchase order line each and the four
-- orphans hold none. Raw name lengths 50, 23, 50, 22, 52, 22, 41 and 18.
-- Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST. Counted before any write, so c1 and c2 measure this script
-- rather than reporting what it just did.
create temp table _pre37 on commit drop as
  select (select count(*) from vessl.products where active is distinct from false) as selectable_before,
         (select count(*) from (
            select lower(btrim(sku)) k from vessl.products
             where active is distinct from false and sku is not null and btrim(sku) <> ''
             group by 1 having count(*) > 1) z)                                    as dup_groups_before,
         (select count(*) from vessl.products)                                     as products_before;

-- Every purchase order line belonging to any of the eight rows, with the stamped
-- sku, so b3 and b4 can prove none of them moved or was restamped.
create temp table _po37 on commit drop as
  select i.id, i.product_id, i.product_sku
    from vessl.purchase_order_items i
   where i.product_id in (
     '2b564891-51be-4f02-9a63-0f670c00e1d8'::uuid, '1c211704-dcdf-4064-b96a-88c1304e5d7b'::uuid,
     'fd7ef8c7-69b9-460e-8b40-bcf23bb6d02f'::uuid, 'e7bdd071-d44c-4f51-9c49-4dedcc45b20b'::uuid,
     '0eee867a-b5c9-4082-8f92-5b974af63542'::uuid, 'c9113cce-e475-42e6-8e1e-1e96cda0b83c'::uuid,
     '0ea36842-1fc6-4461-8d7a-44bd924b3172'::uuid, 'b9d0fe7a-3ac7-4208-9fab-4d2c224de92e'::uuid);

-- THE MAP. Keyed on id throughout. old_len is the RAW character count of the
-- current name, which is the identity evidence no reflow can fake; new_len is
-- what the rename must produce.
create temp table _m37 (
  survivor_id uuid, orphan_id uuid, quote_id uuid,
  survivor_old_len int, orphan_old_len int, new_name text, new_len int
) on commit drop;
insert into _m37 values
  ('2b564891-51be-4f02-9a63-0f670c00e1d8'::uuid, '1c211704-dcdf-4064-b96a-88c1304e5d7b'::uuid,
   'f909490f-c49f-4355-8b90-90d82f19bf09'::uuid, 50, 23, 'Cotton Christmas Bag Red Reindeer', 33),
  ('fd7ef8c7-69b9-460e-8b40-bcf23bb6d02f'::uuid, 'e7bdd071-d44c-4f51-9c49-4dedcc45b20b'::uuid,
   '63761fa6-2272-48f2-bf13-b96751d5e2f0'::uuid, 50, 22, 'Cotton Christmas Bag Green Trees', 32),
  ('0eee867a-b5c9-4082-8f92-5b974af63542'::uuid, 'c9113cce-e475-42e6-8e1e-1e96cda0b83c'::uuid,
   'df1ac831-c38d-4975-a730-5305441b325b'::uuid, 52, 22, 'Cotton Christmas Bag Blue Snowflake', 35),
  ('0ea36842-1fc6-4461-8d7a-44bd924b3172'::uuid, 'b9d0fe7a-3ac7-4208-9fab-4d2c224de92e'::uuid,
   'fadca03d-941b-4d18-811b-1f02219aa67f'::uuid, 41, 18, 'VIP Drawstring Bag Black', 24);

-- Identity snapshot, taken before anything is written.
create temp table _b37 on commit drop as
  select p.id, p.sku, p.name, length(p.name) as name_len, p.active
    from vessl.products p
   where p.id in (select survivor_id from _m37) or p.id in (select orphan_id from _m37);

-- 1. RETIRE THE ORPHANS. Guarded on still-selectable so a row somebody retired in
--    the meantime is skipped and fails b1 loudly rather than being written over.
update vessl.products p
   set active = false
  from _m37 m
 where p.id = m.orphan_id
   and p.active is distinct from false;

-- 2. RENAME THE SURVIVORS. Keyed on id, and additionally on the raw length of the
--    name being replaced, so a row whose name has changed since this was measured
--    is left alone rather than overwritten.
update vessl.products p
   set name = m.new_name
  from _m37 m
 where p.id = m.survivor_id
   and length(p.name) = m.survivor_old_len;

-- 3. MOVE THE ORPHAN QUOTE. Guarded on the link still pointing where it did, so
--    a quote repointed by somebody else is not silently taken over.
update vessl.quotes q
   set product_id = m.survivor_id
  from _m37 m
 where q.id = m.quote_id
   and q.product_id = m.orphan_id;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 eight rows, all selectable, at the exact raw name lengths' as chk,
         (select count(*)::text from _b37 b
           where b.active is distinct from false
             and (exists (select 1 from _m37 m where m.survivor_id = b.id and m.survivor_old_len = b.name_len)
               or exists (select 1 from _m37 m where m.orphan_id   = b.id and m.orphan_old_len   = b.name_len))) as got,
         '8' as want
  union all
  select 'a1 the four orphans carried no purchase order line',
         (select count(*)::text from _po37 p join _m37 m on m.orphan_id = p.product_id), '0'
  union all
  select 'b1 the four orphans are retired',
         (select count(*)::text from vessl.products p join _m37 m on m.orphan_id = p.id
           where p.active = false), '4'
  union all
  -- Length, not text. The names are literals in the update above and a paste that
  -- lost a character would store a wrong one silently.
  select 'b2 the four survivors renamed, each to its exact new length',
         (select count(*)::text from vessl.products p join _m37 m on m.survivor_id = p.id
           where length(p.name) = m.new_len), '4'
  union all
  select 'b3 no purchase order line changed which product it points at',
         (select count(*)::text from _po37 s join vessl.purchase_order_items i on i.id = s.id
           where i.product_id is not distinct from s.product_id), '4'
  union all
  select 'b4 and none was restamped with a different sku',
         (select count(*)::text from _po37 s join vessl.purchase_order_items i on i.id = s.id
           where i.product_sku is not distinct from s.product_sku), '4'
  union all
  select 'b5 the four quotes now point at their survivor',
         (select count(*)::text from vessl.quotes q join _m37 m on m.quote_id = q.id
           where q.product_id = m.survivor_id), '4'
  union all
  select 'b6 nothing points at a retired row any more',
         (select (
            (select count(*) from vessl.quotes q join _m37 m on m.orphan_id = q.product_id) +
            (select count(*) from vessl.purchase_order_items i join _m37 m on m.orphan_id = i.product_id)
          )::text), '0'
  union all
  select 'b7 each survivor now carries two quotes',
         (select count(*)::text from (
            select m.survivor_id from _m37 m
              join vessl.quotes q on q.product_id = m.survivor_id
             group by m.survivor_id having count(*) = 2) z), '4'
  union all
  select 'b8 the survivors are still selectable',
         (select count(*)::text from vessl.products p join _m37 m on m.survivor_id = p.id
           where p.active is distinct from false), '4'
  union all
  -- DIFFERENCES, not absolutes. The BG09RL-EXW orphan is being retired by hand
  -- and may or may not have been done before this runs.
  select 'c1 selectable products down by exactly four',
         (select ((select selectable_before from _pre37)
                - (select count(*) from vessl.products where active is distinct from false))::text), '4'
  union all
  select 'c2 duplicate sku groups down by exactly four',
         (select ((select dup_groups_before from _pre37)
                - (select count(*) from (
                     select lower(btrim(sku)) k from vessl.products
                      where active is distinct from false and sku is not null and btrim(sku) <> ''
                      group by 1 having count(*) > 1) z))::text), '4'
  union all
  select 'c3 no product row created or deleted',
         (select ((select count(*) from vessl.products) - (select products_before from _pre37))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
