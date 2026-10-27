-- 60 -- the board becomes manual, and starts empty.
--
-- WHY EVERY ROW GOES. All 314 programs were created by derivation -- the script 48
-- seed, and the five call sites that mint a program whenever a quote, a purchase
-- order or a sales order is saved. Riley wants the board to be a thing people keep
-- by hand, so the only door becomes a tick on the quote form. A table half full of
-- rows nobody chose would make the new board a mixture of two ideas, which is worse
-- than either. Fresh start, on Riley word.
--
-- NOTHING IS LOST. archive/2026-09-17-programs-before-manual-reset.json holds all
-- 314 rows as they stood, with the product and client each names and the quote, PO
-- line and SO line counts behind them. The orders, quotes and products themselves
-- are untouched -- a program is a card about work, not the work.
--
-- WHAT IT DOES
--   1. deletes all 314 programs
--   2. widens the declared_stage CHECK from NULL or sampling to the nine stages the
--      manual board uses -- quoted, sample_1 to sample_5, testing, purchase_order,
--      complete
--   3. adds owner_id, a foreign key to staff_profiles, and an index on it
--
-- WHAT IT DOES NOT DO
--   No stage_changed_at column. declared_stage_at already exists and
--   trg_programs_declared_stage_at has stamped it with clock_timestamp since script
--   49, on insert and on every change. The manual board reads it as the age of a
--   card, and the trigger keeps working unchanged.
--
-- CASCADE, MEASURED RATHER THAN ASSUMED. program_notes references programs ON
-- DELETE CASCADE and holds ZERO rows today, so this delete cascades nothing. The
-- guard refuses to run if that has changed, because notes are append-only prose
-- somebody typed and deleting them silently is not a thing this script may do.
--
-- MEASURED BEFORE WRITING, against the live database
--   314 programs, 176 live and 138 archived, every declared_stage NULL.
--   0 program_notes. 7 staff_profiles. The CHECK is still the narrow one script 54
--   left, and there is no owner_id column yet.

begin;

-- Baselines, so the checks can prove what did NOT move.
create temp table t_base on commit drop as
select (select count(*) from vessl.programs)                     as base_programs,
       (select count(*) from vessl.program_notes)                as base_notes,
       (select count(*) from vessl.products)                     as base_products,
       (select count(*) from vessl.quotes)                       as base_quotes,
       (select count(*) from vessl.purchase_order_items)         as base_poi,
       (select count(*) from vessl.sales_order_items)            as base_soi,
       (select count(*) from vessl.companies)                    as base_companies,
       (select count(*) from vessl.staff_profiles)               as base_staff,
       (select count(*) from pg_constraint
         where conrelid = 'vessl.programs'::regclass
           and conname = 'programs_declared_stage_check'
           and pg_get_constraintdef(oid) like '%sampling%')       as base_narrow_check,
       (select count(*) from information_schema.columns
         where table_schema = 'vessl' and table_name = 'programs'
           and column_name = 'owner_id')                          as base_owner_col;

-- REFUSE rather than delete a table that is not the one measured.
do $guard$
begin
  if (select base_programs from t_base) <> 314
     or (select base_notes from t_base) <> 0
     or (select base_narrow_check from t_base) <> 1
     or (select base_owner_col from t_base) <> 0
     or (select base_staff from t_base) < 1 then
    raise exception 'the programs table is not the one measured, nothing changed';
  end if;
end
$guard$;

-- 1. Every card goes. The archive holds them.
delete from vessl.programs;

-- 2. The nine stages the manual board offers. Old value sampling is deliberately
-- NOT carried forward -- no row uses it, and keeping a tenth spelling of sampling
-- beside sample_1 would be two names for one idea.
alter table vessl.programs
  drop constraint programs_declared_stage_check;
alter table vessl.programs
  add constraint programs_declared_stage_check
  check (declared_stage is null or declared_stage in
         ('quoted','sample_1','sample_2','sample_3','sample_4','sample_5','testing','purchase_order','complete'));

-- 3. Who keeps the card. NULL is a real state, unowned, and the board shows those
-- rather than hiding them. A foreign key rather than an email string, because every
-- person who could own one already has a staff_profiles row and a key cannot hold a
-- typo. ON DELETE SET NULL, since removing a colleague must not remove their cards.
alter table vessl.programs
  add column owner_id uuid references vessl.staff_profiles(id) on delete set null;

create index programs_owner_idx on vessl.programs (owner_id);

-- ── PROBES, all undone even on commit ───────────────────────────────────────
-- Three questions the checks below cannot answer by reading the catalogue. Each
-- runs inside a subtransaction forced to roll back, so nothing survives. plpgsql
-- variables do survive that rollback, which is what carries the answers out.
-- Column list FIRST, then on commit drop. The AS query form further up accepts
-- the clauses the other way round, which is what made this easy to get wrong.
create temp table t_probe (name text, got text) on commit drop;

do $probe$
declare
  pid uuid; cid uuid; sid uuid;
  valid_ok text := 'no'; old_refused text := 'no'; owner_refused text := 'no';
begin
  select id into pid from vessl.products order by id limit 1;
  select id into cid from vessl.companies order by id limit 1;
  select id into sid from vessl.staff_profiles order by id limit 1;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, owner_id, archived)
    values (pid, cid, 'sample_3', sid, false);
    valid_ok := 'yes';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when check_violation then valid_ok := 'no';
  end;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, archived)
    values (pid, cid, 'sampling', false);
    old_refused := 'no';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when check_violation then old_refused := 'yes';
  end;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, owner_id, archived)
    values (pid, cid, 'quoted', gen_random_uuid(), false);
    owner_refused := 'no';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when foreign_key_violation then owner_refused := 'yes';
  end;

  insert into t_probe values ('valid stage accepted', valid_ok),
                             ('old sampling refused', old_refused),
                             ('unknown owner refused', owner_refused);
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
with _pre60 as (
  select (select count(*) from vessl.programs)      as now_programs,
         (select count(*) from vessl.program_notes) as now_notes,
         (select count(*) from vessl.products)      as now_products,
         (select count(*) from vessl.quotes)        as now_quotes,
         (select count(*) from vessl.purchase_order_items) as now_poi,
         (select count(*) from vessl.sales_order_items)    as now_soi,
         (select count(*) from vessl.companies)     as now_companies,
         (select count(*) from vessl.staff_profiles) as now_staff,
         (select count(*) from unnest(array['quoted','sample_1','sample_2','sample_3','sample_4',
                                            'sample_5','testing','purchase_order','complete']) v
           where (select pg_get_constraintdef(oid) from pg_constraint
                   where conrelid = 'vessl.programs'::regclass
                     and conname = 'programs_declared_stage_check') like '%' || v || '%') as stages_named,
         (select count(*) from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_declared_stage_check'
             and pg_get_constraintdef(oid) like '%sampling%') as sampling_still_there,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs' and column_name = 'owner_id') as owner_col,
         (select count(*) from pg_constraint
           where conrelid = 'vessl.programs'::regclass and contype = 'f'
             and confrelid = 'vessl.staff_profiles'::regclass) as owner_fk,
         (select count(*) from pg_indexes
           where schemaname = 'vessl' and tablename = 'programs' and indexname = 'programs_owner_idx') as owner_idx,
         (select count(*) from pg_trigger
           where tgrelid = 'vessl.programs'::regclass and tgname = 'trg_programs_declared_stage_at') as stamp_trigger,
         (select got from t_probe where name = 'valid stage accepted')  as probe_valid,
         (select got from t_probe where name = 'old sampling refused')  as probe_old,
         (select got from t_probe where name = 'unknown owner refused') as probe_owner,
         b.base_programs, b.base_notes, b.base_products, b.base_quotes, b.base_poi,
         b.base_soi, b.base_companies, b.base_staff
    from t_base b
)
select * from (
  select 'a0 three hundred and fourteen programs were there, before the delete' as chk,
         (select base_programs::text from _pre60) as got, '314' as want
  union all
  select 'a1 no notes existed, so the cascade took nothing',
         (select base_notes::text from _pre60), '0'
  union all
  select 'b1 the programs table is now empty',
         (select now_programs::text from _pre60), '0'
  union all
  select 'b2 program notes is still empty',
         (select now_notes::text from _pre60), '0'
  union all
  select 'b3 the new CHECK names all nine stages',
         (select stages_named::text from _pre60), '9'
  union all
  select 'b4 the old sampling value is gone from the CHECK',
         (select sampling_still_there::text from _pre60), '0'
  union all
  select 'b5 owner_id exists and is a key into staff_profiles',
         (select owner_col::text || '/' || owner_fk::text from _pre60), '1/1'
  union all
  select 'b6 the owner index exists',
         (select owner_idx::text from _pre60), '1'
  union all
  -- The stamp trigger is script 49 work and this script must not disturb it.
  select 'b7 the declared_stage_at trigger is still attached',
         (select stamp_trigger::text from _pre60), '1'
  union all
  select 'b8 a real stage inserts, sampling and an unknown owner do not',
         (select probe_valid || '/' || probe_old || '/' || probe_owner from _pre60), 'yes/yes/yes'
  union all
  -- NOTHING ELSE MOVED. A program is a card about work, and deleting the cards
  -- leaves the work exactly where it was.
  select 'c1 products, quotes, PO lines, SO lines unchanged',
         (select (now_products - base_products)::text || '/' || (now_quotes - base_quotes)::text || '/'
                 || (now_poi - base_poi)::text || '/' || (now_soi - base_soi)::text from _pre60), '0/0/0/0'
  union all
  select 'c2 companies and staff unchanged',
         (select (now_companies - base_companies)::text || '/' || (now_staff - base_staff)::text from _pre60), '0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
