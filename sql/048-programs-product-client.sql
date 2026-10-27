-- 48 -- programs rebuilt as product x client. docs/PLM.md phase 2A.
--
-- ══ RUN ORDER. READ THIS BEFORE RUNNING ANYTHING ═══════════════════════════
-- THIS SCRIPT BREAKS RUNNING CODE THE MOMENT IT COMMITS, and one of the paths it
-- breaks is saving a quote.
--
-- Renaming programs to programs_legacy and putting a differently shaped table in
-- its place leaves three files calling columns that no longer exist --
--
--   app/quotes.jsx line 1231     inserts a program on QUOTE SAVE, with product,
--                                sku, client, factory, stage. This is a daily
--                                path and it starts erroring immediately.
--   app/programs.jsx             the whole page. Reads stage, writes stage,
--                                inserts program_tasks.
--   app/components/RenameSkuModal.jsx lines 90 and 91, matches on sku and
--                                quote_sku inside the rename preflight.
--
-- SO THE SAFE ORDER IS THREE STEPS, NOT TWO.
--   1. Ship code that stops writing to the old shape -- the quote-save hook and
--      the RenameSkuModal lookup come out, the Programs page is stubbed.
--   2. Run this script.
--   3. Ship the new Programs page.
--
-- Running this first leaves quote saving broken for as long as the deploy takes.
-- Section 2 below is additive and safe on its own if the column is wanted early.
--
-- ══ WHAT IT DOES ═══════════════════════════════════════════════════════════
-- A program is a PRODUCT FOR A CLIENT. Five stages are derived from that client
-- own records -- Quoted, Ordered, Shipped, Delivered, Sold -- and are therefore
-- not stored. Two are declared by hand, Inquiry and Sampling, and those are the
-- only values declared_stage accepts.
--
-- The old table stored a NINE VALUE ladder in one column, which is why the
-- rebuild is a new table rather than a migration. Seven of those nine are now
-- computed, and a column that can still hold them is a column that will drift
-- from what the records say.
--
-- ── THE OLD TABLES ARE A PROTOTYPE, NOT A DATASET ───────────────────────────
-- programs holds ONE row, program_tasks holds 8 with none done, program_notes
-- holds ZERO. Nothing of consequence is being moved, which is the only reason a
-- rebuild is cheaper than a migration here.
--
-- program_notes carrying into the new table is therefore a NO OP -- a6 asserts
-- the legacy table is empty rather than writing mapping code for zero rows. If
-- that count is ever not zero, this script fails there instead of silently
-- dropping somebody notes.
--
-- program_tasks is out of 2A entirely, per docs/PLM.md. The legacy table keeps its 8
-- rows and its foreign key follows the rename.
--
-- ── QUOTES GAIN A REAL CLIENT ───────────────────────────────────────────────
-- quotes.client is FREE TEXT and is the only way to scope Quoted to a client.
-- 328 of 331 resolve to exactly one company by name. This adds
-- client_company_id and backfills those 328.
--
-- THE THREE THAT DO NOT RESOLVE stay NULL and go to Kristy. They read Legal and
-- Legoland New York, and neither is a company row. NULL means not resolved, and
-- the seed simply does not produce a pair for them.
--
-- ── SEEDING, 334 PAIRS ──────────────────────────────────────────────────────
-- Every product x client pair the records already prove, from three sources --
-- quotes, sales order lines, purchase order lines.
--
--   173 pairs on SELECTABLE products, seeded archived false.
--   161 pairs on RETIRED products, seeded archived TRUE. They are history and
--       should not open a working list, but they are real and are kept.
--
-- 332 distinct products across 334 pairs. ONLY TWO products run for more than
-- one client -- BUC-138 and LLF-1617 -- so the compound key earns almost nothing
-- today. It is here because adding it later is a migration and adding it now is
-- a column, which is the trade Matt took deliberately.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- programs 1 row, program_tasks 8, program_notes 0. quotes 331 rows, 328 with a
-- product and a resolvable client, 3 unresolvable. 334 distinct pairs, 173 on
-- selectable products and 161 on retired. is_staff() exists and is SECURITY
-- DEFINER, which is what the old policies use. Rehearsal z0, commit z0.

begin;

create temp table _pre48 on commit drop as
  select (select count(*) from vessl.programs)       as prog_before,
         (select count(*) from vessl.program_tasks)  as task_before,
         (select count(*) from vessl.program_notes)  as note_before,
         (select count(*) from vessl.quotes)         as quote_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes'
             and column_name = 'client_company_id')  as qcol_before;

-- ── 2. QUOTES GAIN A CLIENT FK. Additive, and safe on its own. ─────────────
alter table vessl.quotes add column client_company_id uuid references vessl.companies(id);

update vessl.quotes q
   set client_company_id = c.id
  from vessl.companies c
 where lower(btrim(c.name)) = lower(btrim(q.client))
   and q.client_company_id is null;

create index quotes_client_company_id_idx
  on vessl.quotes (client_company_id) where client_company_id is not null;

-- ── 3. THE OLD TABLES STEP ASIDE. Foreign keys follow a rename. ────────────
alter table vessl.programs       rename to programs_legacy;
alter table vessl.program_tasks  rename to program_tasks_legacy;
alter table vessl.program_notes  rename to program_notes_legacy;

-- ── 4. THE NEW SHAPE ───────────────────────────────────────────────────────
create table vessl.programs (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references vessl.products(id) on delete cascade,
  client_company_id   uuid not null references vessl.companies(id),
  -- INQUIRY AND SAMPLING ONLY. The other seven stages are derived from records
  -- and must not be storable, or the stored one will disagree with them.
  declared_stage      text,
  expected_ship_date  date,
  -- The factory update sheet round trip, given columns instead of prose. Today
  -- the import concatenates these into a note and the dates stop being dates.
  factory_status      text,
  factory_pct         int,
  factory_reported_at timestamptz,
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint programs_declared_stage_check
    check (declared_stage is null or declared_stage in ('inquiry','sampling')),
  constraint programs_factory_pct_check
    check (factory_pct is null or (factory_pct >= 0 and factory_pct <= 100)),
  constraint programs_product_client_key unique (product_id, client_company_id)
);

create table vessl.program_notes (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references vessl.programs(id) on delete cascade,
  author      text,
  source      text,
  note        text not null,
  created_at  timestamptz not null default now()
);

create index programs_archived_idx on vessl.programs (archived);
create index program_notes_program_id_idx on vessl.program_notes (program_id);

-- ── 5. GRANTS. THE REVOKE IS NOT OPTIONAL. ─────────────────────────────────
-- ALTER DEFAULT PRIVILEGES on this schema hands authenticated the full
-- arwdDxtm set on every new table at CREATE time. Script 34 found that the hard
-- way. Revoke first, then grant only what PostgREST needs -- and no DELETE,
-- because a program is archived rather than removed.
revoke all on vessl.programs from authenticated;
revoke all on vessl.program_notes from authenticated;
grant select, insert, update on vessl.programs to authenticated;
grant select, insert on vessl.program_notes to authenticated;

alter table vessl.programs enable row level security;
alter table vessl.program_notes enable row level security;

create policy staff_only on vessl.programs
  for all to authenticated using (vessl.is_staff()) with check (vessl.is_staff());
create policy staff_only on vessl.program_notes
  for all to authenticated using (vessl.is_staff()) with check (vessl.is_staff());

-- ── 6. SEED. Every pair the records already prove. ─────────────────────────
-- ARCHIVED IS `is not distinct from false`, NOT `= false`.
--
-- products.active is THREE STATE -- true, false, and NULL meaning nobody has
-- said. NULL is SELECTABLE everywhere else in this app, and `p.active = false`
-- evaluates to NULL for those rows rather than to false, which the NOT NULL on
-- archived then rejects outright. The first rehearsal died exactly there.
--
-- `is not distinct from false` returns true only for a literal false and false
-- for NULL, which is the reading the rest of the catalogue uses.
insert into vessl.programs (product_id, client_company_id, archived)
select d.pid, d.cid, (p.active is not distinct from false)
  from (
    select distinct pid, cid from (
      select q.product_id as pid, q.client_company_id as cid
        from vessl.quotes q
       where q.product_id is not null and q.client_company_id is not null
      union all
      select s.product_id, so.client_company_id
        from vessl.sales_order_items s
        join vessl.sales_orders so on so.id = s.sales_order_id
       where s.product_id is not null and so.client_company_id is not null
      union all
      select i.product_id, po.client_company_id
        from vessl.purchase_order_items i
        join vessl.purchase_orders po on po.id = i.purchase_order_id
       where i.product_id is not null and po.client_company_id is not null
    ) u
  ) d
  join vessl.products p on p.id = d.pid;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the old programs table held one row' as chk,
         (select prog_before::text from _pre48) as got, '1' as want
  union all
  select 'a1 and program_tasks held eight',
         (select task_before::text from _pre48), '8'
  union all
  -- THE NO OP CARRY, asserted rather than coded. If this is ever not zero the
  -- script stops here instead of dropping somebody notes on the floor.
  select 'a2 legacy program_notes was empty, so nothing needed carrying',
         (select note_before::text from _pre48), '0'
  union all
  select 'a3 quotes had no client column before this',
         (select qcol_before::text from _pre48), '0'
  union all
  select 'b1 the three legacy tables exist under their new names',
         (select count(*)::text from information_schema.tables
           where table_schema = 'vessl'
             and table_name in ('programs_legacy','program_tasks_legacy','program_notes_legacy')), '3'
  union all
  select 'b2 and the legacy rows came through the rename intact',
         (select (select count(*) from vessl.programs_legacy)::text || ' and ' ||
                 (select count(*) from vessl.program_tasks_legacy)::text), '1 and 8'
  union all
  select 'b3 quotes carry a resolved client on the three hundred and twenty eight',
         (select count(*) filter (where client_company_id is not null)::text from vessl.quotes), '328'
  union all
  -- THE THREE FOR KRISTY. Named by absence, not by a NOT filter on the join.
  select 'b4 and three are unresolved, which is the number for Kristy',
         (select count(*) filter (where client_company_id is null)::text from vessl.quotes), '3'
  union all
  select 'c1 three hundred and thirty four programs seeded',
         (select count(*)::text from vessl.programs), '334'
  union all
  select 'c2 one hundred and seventy three of them are live',
         (select count(*) filter (where archived = false)::text from vessl.programs), '173'
  union all
  select 'c3 and one hundred and sixty one are archived history',
         (select count(*) filter (where archived = true)::text from vessl.programs), '161'
  union all
  select 'c4 every archived program is on a retired product',
         (select count(*)::text from vessl.programs pr join vessl.products p on p.id = pr.product_id
           where pr.archived = true and p.active = false), '161'
  union all
  select 'c5 and every live one is on a selectable product',
         (select count(*)::text from vessl.programs pr join vessl.products p on p.id = pr.product_id
           where pr.archived = false and p.active is distinct from false), '173'
  union all
  select 'c6 no program carries a declared stage yet',
         (select count(*) filter (where declared_stage is null)::text from vessl.programs), '334'
  union all
  select 'c7 the pair is unique, so the count equals the distinct pairs',
         (select count(*)::text from (select distinct product_id, client_company_id from vessl.programs) x), '334'
  union all
  -- THE GRANT TRAP. If d1 ever reads true the schema default has changed and
  -- the revoke above is doing nothing.
  select 'd1 authenticated cannot delete a program',
         (select has_table_privilege('authenticated','vessl.programs','delete')::text), 'false'
  union all
  select 'd2 but can read, insert and update one',
         (select (has_table_privilege('authenticated','vessl.programs','select')
              and has_table_privilege('authenticated','vessl.programs','insert')
              and has_table_privilege('authenticated','vessl.programs','update'))::text), 'true'
  union all
  select 'd3 row level security is on for both new tables',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname in ('programs','program_notes')
             and c.relrowsecurity), '2'
  union all
  select 'd4 and both carry the staff policy',
         (select count(*)::text from pg_policies
           where schemaname = 'vessl' and tablename in ('programs','program_notes')
             and policyname = 'staff_only'), '2'
  union all
  select 'd5 the declared stage check rejects anything else',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_declared_stage_check'), '1'
  union all
  select 'e1 no quote was created or deleted',
         (select ((select count(*) from vessl.quotes) - (select quote_before from _pre48))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
