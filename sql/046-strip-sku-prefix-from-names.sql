-- 46 -- eleven product names that begin with their own SKU.
--
-- The pattern script 37 cleaned, in the rows it did not reach. A product named
-- LLW-1545 Blue Bottle Bubble Bath is not named Blue Bottle Bubble Bath, so a
-- purchase order line saying Blue Bottle Bubble Bath matches nothing -- and the
-- product looks missing when it is sitting right there.
--
-- ── WHAT IT UNLOCKS, HONESTLY ───────────────────────────────────────────────
-- ONE purchase order line. That is the whole linking benefit, measured.
--
-- Line f873c442 on purchase order 1302600279256, in_production, quantity 45000,
-- description Blue Bottle Bubble Bath. After this it matches LLW-1545 alone and
-- script 45 pass 1 would take it.
--
-- The other ten unlock nothing today. They are included because this is one
-- latent fault with eleven instances, and fixing the one that happens to be
-- visible leaves ten to be rediscovered later -- which is how the BG09RL orphan
-- and the BUC-157 duplicate both got found twice.
--
-- ── SCOPED TO SELECTABLE ROWS, AND WHY ──────────────────────────────────────
-- 31 products carry the pattern. 20 of them are RETIRED and are not touched.
--
-- Cleaning the retired ones would change nothing that matters and would rewrite
-- history rows. Proven, not assumed -- the two remaining unmatched descriptions
-- both resolve to retired rows even after a strip, so they stay unlinkable
-- either way, and this is the measurement that says so.
--
--   Mock Neck Parke Ville White   5 lines. Five RETIRED size rows carry that
--                                 name behind a prefix. The live parent LHS-183
--                                 is named Mock neck fleece, which is a
--                                 different product name. Stripping would make
--                                 the lines match five retired rows -- ambiguous
--                                 retired, which script 45 leaves alone by
--                                 design.
--   White Aviator Nation Tee      1 line. One RETIRED size row, LHS-152 Small,
--                                 carries it. The live parent LHS-152 is named
--                                 Aviator Nation Crew White and already holds 3
--                                 linked lines. Stripping makes it match one
--                                 retired row, still not a selectable match.
--
-- So those six lines are NOT a naming problem. They are the size-row question,
-- and they stay on the list for Kristy.
--
-- ── THE NEW NAMES ARE WRITTEN OUT, NOT COMPUTED ─────────────────────────────
-- Computing them in SQL would need either a backslash class or a POSIX class
-- carrying colons, and collapsing runs of spaces needs a two-space literal. All are
-- barred by the transport rules these scripts follow, and every one of them is
-- barred for a reason that has already bitten. Eleven literals are reviewable on
-- sight and cost nothing.
--
-- Two names carry an internal run of spaces before a trailing colour word, and
-- both are written collapsed to single spaces here.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 11 selectable products carry the pattern, 20 retired ones also do. Every one of
-- the 11 new names is free -- 0 collisions against any product name, retired
-- included. products.name is not stamped on any document -- purchase order lines
-- carry their own description text and quotes carry their own product text -- so
-- nothing printed changes. Rehearsal z0, commit z0.

begin;

create temp table _pre46 on commit drop as
  select (select count(*) from vessl.products)                                     as rows_before,
         (select count(*) from vessl.products where active is distinct from false) as selectable_before,
         (select count(*) from vessl.purchase_order_items where product_id is null) as unlinked_before;

-- id, the exact length of the name being replaced, and the replacement. The
-- length is the guard -- a row somebody has renamed since measuring fails a0
-- rather than being quietly overwritten with a stale value.
create temp table _m46 (pid uuid, old_len int, new_name text) on commit drop;
insert into _m46 values
  ('9e073d30-d650-4c69-ae53-2574e7d3d077'::uuid, 35, 'Leopard print reuse bag'),
  ('030d00e9-a6f8-49bb-9874-8858b24625c4'::uuid, 26, 'Reuse LOGO bag'),
  ('acbca34f-88f6-4582-9ac7-f193fec05ed0'::uuid, 29, 'Tie Dye reuse bag'),
  ('c7cd7c45-0efe-459e-a962-c9fc7eb72893'::uuid, 30, 'Leesville Ball Cap'),
  ('fe74a105-474f-4b83-9f61-b60d0b8f9e32'::uuid, 20, 'Camo Hat'),
  ('6795facd-3421-47bc-b65a-2ff2c5bf98fc'::uuid, 31, 'Leesville Bag Charm'),
  ('4c1ef288-e631-4308-916d-5b60b71f8418'::uuid, 50, 'Kids Poncho with Packaging Yellow'),
  ('5a47c613-b517-44b2-90e0-ed0efcfb8ec6'::uuid, 34, 'Waterpark Beach Towel'),
  ('bb3a7a79-c233-4ec0-9d68-7efd327520d0'::uuid, 26, 'Parks Beach Towel'),
  ('7898ba33-8b9c-4fa1-afdc-7bf2385c4f43'::uuid, 51, 'Adult Poncho with Packaging Yellow'),
  ('ee9db0fd-b35d-429e-a78c-a74ffcecd738'::uuid, 36, 'Blue Bottle Bubble Bath');

create temp table _b46 on commit drop as
  select p.id, p.sku, p.name, p.active, length(p.name) as n_len
    from vessl.products p where p.id in (select pid from _m46);

update vessl.products p
   set name = m.new_name
  from _m46 m
 where p.id = m.pid
   and length(p.name) = m.old_len
   and p.active is distinct from false;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 eleven rows, at their exact measured name lengths' as chk,
         (select count(*)::text from _b46 b join _m46 m on m.pid = b.id
           where b.n_len = m.old_len) as got, '11' as want
  union all
  select 'a1 and every one of them was selectable',
         (select count(*)::text from _b46 where active is distinct from false), '11'
  union all
  -- THE PATTERN ITSELF, proven present before it is removed.
  select 'a2 every name began with its own sku',
         (select count(*)::text from _b46 b
           where b.name like b.sku || '%'), '11'
  union all
  select 'a3 no new name was already taken by another product',
         (select count(*)::text from _m46 m
           join vessl.products p on lower(btrim(p.name)) = lower(m.new_name)
           where p.id is distinct from m.pid), '0'
  union all
  select 'b1 all eleven now carry the stripped name',
         (select count(*)::text from vessl.products p join _m46 m on m.pid = p.id
           where p.name = m.new_name), '11'
  union all
  select 'b2 and not one of them still begins with its sku',
         (select count(*)::text from vessl.products p join _m46 m on m.pid = p.id
           where p.name like p.sku || '%'), '0'
  union all
  -- THE POINT OF THE SCRIPT. One line becomes resolvable, and it is that one.
  select 'b3 the bubble bath line now matches exactly one selectable product',
         (select count(*)::text from vessl.products p
           where lower(btrim(p.name)) = 'blue bottle bubble bath'
             and p.active is distinct from false), '1'
  union all
  select 'b4 and it is LLW-1545 that it matches',
         (select p.sku::text from vessl.products p
           where lower(btrim(p.name)) = 'blue bottle bubble bath'
             and p.active is distinct from false), 'LLW-1545'
  union all
  -- THE TWENTY RETIRED ROWS, deliberately untouched.
  select 'b5 the retired prefixed rows still carry their prefix',
         (select count(*)::text from vessl.products p
           where p.sku is not null and p.name like p.sku || '%' and p.active = false), '20'
  union all
  select 'c1 no sku changed',
         (select count(*)::text from _b46 b join vessl.products p on p.id = b.id
           where p.sku is not distinct from b.sku), '11'
  union all
  select 'c2 no product created, deleted or retired',
         (select ((select count(*) from vessl.products) - (select rows_before from _pre46))::text || ' and ' ||
                 ((select count(*) from vessl.products where active is distinct from false)
                - (select selectable_before from _pre46))::text), '0 and 0'
  union all
  -- This script links nothing itself. Script 45 does that, on a later run.
  select 'c3 no purchase order line was linked by this script',
         (select ((select unlinked_before from _pre46)
                - (select count(*) from vessl.purchase_order_items where product_id is null))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
