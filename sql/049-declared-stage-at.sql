-- 49 -- programs.declared_stage_at, stamped by a trigger.
--
-- The PLM board shows how long a card has sat in its column. Two of the four
-- stages can answer that from records already -- Quoted from the first quote
-- date, Tested from the first test date. The two DECLARED stages, Inquiry and
-- Sampling, have nothing to answer with.
--
-- programs carries created_at and updated_at and nothing else. updated_at moves
-- on any edit, so it is not a stage-entry date and using it would put a
-- confident number next to something it does not measure. The old programs table
-- had stage_entered_at; the rebuild dropped it because the rebuild had no ladder.
-- It has one now, on the pre-order half, so the column comes back.
--
-- ── A TRIGGER, AND WHY THIS ONE EARNS IT ────────────────────────────────────
-- Phase 0.5 decided AGAINST a trigger for product linking, and that decision
-- stands -- it was about inferring which product a line meant, which is a
-- judgement no trigger should make.
--
-- This is the opposite kind of thing. declared_stage_at has exactly one correct
-- value at all times, derivable from the row being written and nothing else, and
-- it is WRONG the instant a writer forgets it. The page is not the only possible
-- writer -- the sweep, a later import, a hand fix in the dashboard -- and a
-- timestamp that four callers each have to remember is a timestamp that will
-- drift. purchase_order_items already carries trg_poi_stamp_product_sku for the
-- same reason, so the pattern is the house pattern.
--
-- ── WHAT IT SETS ────────────────────────────────────────────────────────────
--   INSERT           the stamp if a stage was declared, NULL if not.
--   stage CHANGED    now(), so time in the new stage starts from the change.
--   stage CLEARED    NULL. No stage, no date -- rather than a stale one that
--                    would reappear if the stage were set again.
--   anything else    untouched. Editing expected_ship_date does not restart the
--                    clock, which is the whole point of UPDATE OF declared_stage
--                    in the trigger definition.
--
-- is distinct from, not <>, so a change to or from NULL counts as a change. With
-- <> the clear case would evaluate NULL and the branch would never run.
--
-- ── NO BACKFILL, BECAUSE THERE IS NOTHING TO BACKFILL ───────────────────────
-- All 334 programs carry declared_stage NULL. Nobody has declared a stage yet --
-- the page shipped yesterday. So every row correctly gets NULL here, and a1
-- asserts that rather than assuming it. A row with a stage but no stamp would
-- mean this ran too late, and the check would catch it.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 334 programs, 0 with a declared stage. No declared_stage_at column, no trigger
-- on the table, no function of that name. Rehearsal z0, commit z0.

begin;

create temp table _pre49 on commit drop as
  select (select count(*) from vessl.programs)                                       as rows_before,
         (select count(*) from vessl.programs where declared_stage is not null)      as declared_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'declared_stage_at')                                  as col_before,
         (select count(*) from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'programs' and not t.tgisinternal) as trg_before;

alter table vessl.programs add column declared_stage_at timestamptz;

-- search_path is pinned so the function cannot be redirected by a caller setting
-- its own, the same precaution the digest function takes.
create or replace function vessl.stamp_declared_stage_at()
returns trigger
language plpgsql
set search_path to 'vessl', 'public'
as $fn$
begin
  -- clock_timestamp, NOT now. now() is TRANSACTION start time and is identical
  -- for every statement in a transaction, which would make two different stage
  -- changes carry the same stamp -- and would make the after-commit check unable
  -- to tell a restamp from no restamp at all, because both readings would be
  -- equal. A stage change is a per-row event, so it takes the wall clock.
  if tg_op = 'INSERT' then
    new.declared_stage_at := case when new.declared_stage is null then null else clock_timestamp() end;
  elsif new.declared_stage is distinct from old.declared_stage then
    new.declared_stage_at := case when new.declared_stage is null then null else clock_timestamp() end;
  end if;
  return new;
end;
$fn$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC, and anon inherits PUBLIC. Calling a
-- trigger function outside a trigger fails on its own, so the exposure is small
-- -- but script 21 found the same default on a function where it was not small,
-- and the revoke costs nothing.
revoke all on function vessl.stamp_declared_stage_at() from public;

create trigger trg_programs_declared_stage_at
  before insert or update of declared_stage on vessl.programs
  for each row execute function vessl.stamp_declared_stage_at();

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the column did not exist before this script' as chk,
         (select col_before::text from _pre49) as got, '0' as want
  union all
  select 'a1 and no program had declared a stage, so nothing needs backfilling',
         (select declared_before::text from _pre49), '0'
  union all
  select 'a2 the table carried no trigger before',
         (select trg_before::text from _pre49), '0'
  union all
  select 'b1 the column exists and is a timestamptz',
         (select data_type::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'declared_stage_at'), 'timestamp with time zone'
  union all
  select 'b2 it is nullable, because no stage means no date',
         (select is_nullable::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'declared_stage_at'), 'YES'
  union all
  select 'b3 the function exists',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'stamp_declared_stage_at'), '1'
  union all
  select 'b4 with its search_path pinned',
         (select (p.proconfig is not null)::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'stamp_declared_stage_at'), 'true'
  union all
  select 'b5 and public cannot execute it',
         (select has_function_privilege('public','vessl.stamp_declared_stage_at()','execute')::text), 'false'
  union all
  -- STRUCTURAL, NOT A STRING COMPARE. The first rehearsal failed here against
  -- pg_get_triggerdef, which renders the function SCHEMA QUALIFIED -- the want
  -- said stamp_declared_stage_at and the catalogue said
  -- vessl.stamp_declared_stage_at. That is a rendering difference, not a fault,
  -- and a check that fails on rendering teaches people to ignore it.
  --
  -- tgtype is a bit mask. 1 row, 2 before, 4 insert, 8 delete, 16 update, 32
  -- truncate. Decoding it names what the trigger actually does, and the absence
  -- of delete and truncate from the answer is itself part of the assertion.
  -- Verified against trg_poi_stamp_product_sku, which decodes the same way.
  select 'b6 it is a before row trigger on insert and update',
         (select array_to_string(array_remove(array[
                   case when (t.tgtype & 2) = 2 then 'before' else 'after' end,
                   case when (t.tgtype & 1) = 1 then 'row' else 'statement' end,
                   case when (t.tgtype & 4) = 4 then 'insert' end,
                   case when (t.tgtype & 16) = 16 then 'update' end,
                   case when (t.tgtype & 8) = 8 then 'delete' end,
                   case when (t.tgtype & 32) = 32 then 'truncate' end], null), ' ')::text
            from pg_trigger t where t.tgname = 'trg_programs_declared_stage_at'),
         'before row insert update'
  union all
  -- THE UPDATE OF CLAUSE IS THE POINT. tgattr holds the columns it watches, so
  -- this names them rather than trusting a sentence. Exactly one, and it is the
  -- right one -- without that, editing any other column would restart the clock
  -- on a stage that had not moved.
  select 'b7 and it watches the declared_stage column alone',
         (select string_agg(a.attname, ',' order by a.attname)
            from pg_trigger t
            join unnest(t.tgattr::int2[]) as u(attnum) on true
            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = u.attnum
           where t.tgname = 'trg_programs_declared_stage_at'),
         'declared_stage'
  union all
  select 'c1 every existing row has a null stamp, matching its null stage',
         (select count(*) filter (where declared_stage_at is null)::text from vessl.programs), '334'
  union all
  select 'c2 no program created or deleted',
         (select ((select count(*) from vessl.programs) - (select rows_before from _pre49))::text), '0'
  union all
  select 'c3 no declared stage changed',
         (select count(*) filter (where declared_stage is not null)::text from vessl.programs), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
