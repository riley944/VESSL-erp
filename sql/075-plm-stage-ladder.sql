-- 75 -- the six stages the board actually runs on.
--
-- WHAT IT DOES. Replaces the declared_stage CHECK on vessl.programs. The ladder
-- becomes quoted, sampling, revision, testing, production, shipped. Two values
-- leave and are migrated first -- purchase_order becomes production, complete
-- becomes shipped. NULL stays allowed, because a card with no stage set is a
-- real state the board draws a column for.
--
-- quoted KEEPS ITS STORED VALUE and is merely labelled Quoting on screen, the
-- same trade COMPLETE_LABEL already makes. Renaming it would mean migrating
-- every row and every reader for a word.
--
-- ZERO ROWS MOVE TODAY, and that is measured rather than hoped. 3 programs
-- exist, 2 on quoted and 1 on sampling, none on purchase_order or complete. The
-- UPDATE is still written, and the guards still count, because the board is in
-- use and that can be false by the time this runs.
--
-- ── THE TRIGGER IS THE TRAP, AND IT IS WHY THE DISABLE IS HERE ───────────────
-- trg_programs_declared_stage_at fires BEFORE INSERT OR UPDATE OF declared_stage
-- and stamps declared_stage_at. A migration that writes declared_stage would
-- therefore restamp it -- turning a card that had sat in Purchase Order for
-- forty days into one that entered Production this morning, and resetting the
-- days-in-stage the whole board is read by.
--
-- With no rows to move that damage is invisible today, which is exactly why it
-- would ship unnoticed and land the next time somebody reruns this shape. So the
-- trigger is disabled around the UPDATE and re-enabled straight after, b5 proves
-- declared_stage_at did not move, and b6 proves the trigger is armed again. A
-- disabled trigger left behind would silently stop stamping every future stage
-- move, which is worse than the thing it was avoiding.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.programs -- 3 rows. quoted 2, sampling 1, purchase_order 0,
--     complete 0, null 0.
--   the CHECK today allows null plus quoted, sampling, testing, purchase_order
--     and complete.
--   trg_programs_declared_stage_at exists and is enabled.

begin;

-- ARCHIVE FIRST. Every row this will touch, as JSON, before a single write.
-- coalesce, because jsonb_agg over no rows is NULL rather than an empty array --
-- and there are no such rows today, so a0 would read null without it.
create temp table _arch75 on commit drop as
  select coalesce(
           (select jsonb_agg(jsonb_build_object('id', p.id,
                                                'product_id', p.product_id,
                                                'client_company_id', p.client_company_id,
                                                'declared_stage_before', p.declared_stage,
                                                'declared_stage_at_before', p.declared_stage_at)
                             order by p.id)
              from vessl.programs p
             where p.declared_stage in ('purchase_order', 'complete')),
           '[]'::jsonb) as touched;

select jsonb_pretty(touched) as rows_to_migrate from _arch75;

-- PRE-STATE, counted before anything is written.
create temp table _pre75 on commit drop as
  select (select count(*) from vessl.programs)                                          as rows_before,
         (select count(*) from vessl.programs where declared_stage = 'purchase_order')  as po_before,
         (select count(*) from vessl.programs where declared_stage = 'complete')        as complete_before,
         (select count(*) from vessl.programs where declared_stage = 'production')      as production_before,
         (select count(*) from vessl.programs where declared_stage = 'shipped')         as shipped_before,
         (select count(*) from vessl.programs where declared_stage is null)             as null_before,
         (select count(*) from vessl.programs
           where declared_stage is not null
             and declared_stage not in ('quoted','sampling','testing','purchase_order','complete'))
                                                                                        as unknown_before,
         (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_declared_stage_check')                             as check_before,
         (select tgenabled::text from pg_trigger
           where tgrelid = 'vessl.programs'::regclass
             and tgname = 'trg_programs_declared_stage_at')                             as trigger_before;

-- REFUSE rather than migrate a table that is not the one measured.
do $guard$
begin
  -- Nothing may be sitting on a value this script does not know how to move. A
  -- row on an unknown string would survive the UPDATE and then fail the new
  -- CHECK, aborting halfway with no message about which row.
  if (select unknown_before from _pre75) <> 0 then
    raise exception 'some program holds a declared_stage outside the five known values, nothing changed';
  end if;
  if (select check_before from _pre75) is null then
    raise exception 'the declared_stage check constraint is not named programs_declared_stage_check, nothing changed';
  end if;
  if (select trigger_before from _pre75) <> 'O' then
    raise exception 'trg_programs_declared_stage_at is not enabled, so this script cannot prove it re-enabled it, nothing changed';
  end if;
end
$guard$;

-- 1. THE OLD RULE COMES OFF FIRST. A CHECK is validated when it is added, so the
--    rows have to be legal under the new list before the new one goes on.
alter table vessl.programs drop constraint programs_declared_stage_check;

-- 2. THE STAMP IS PROTECTED. See the note at the top -- this is the only reason
--    the migration does not reset every migrated card to today.
alter table vessl.programs disable trigger trg_programs_declared_stage_at;

update vessl.programs
   set declared_stage = case declared_stage
                          when 'purchase_order' then 'production'
                          when 'complete'       then 'shipped'
                          else declared_stage
                        end,
       updated_at = now()
 where declared_stage in ('purchase_order', 'complete');

alter table vessl.programs enable trigger trg_programs_declared_stage_at;

-- 3. THE NEW LADDER. Written as IN so Postgres normalises it the same way the
--    old one was written, and NULL stays legal on purpose.
alter table vessl.programs
  add constraint programs_declared_stage_check
  check (declared_stage is null
         or declared_stage in ('quoted','sampling','revision','testing','production','shipped'));

comment on column vessl.programs.declared_stage is
  'The stage a person set. quoted, sampling, revision, testing, production, shipped, or NULL for no stage set. quoted is labelled Quoting on screen. shipped is the finished state. Only one thing moves this without a person -- a purchase order saved for a product and client whose card sits earlier, which lib/programs.js does and logs as a note.';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the archive captured every row to migrate' as chk,
         (select jsonb_array_length(touched)::text from _arch75) as got,
         (select (po_before + complete_before)::text from _pre75) as want
  union all
  select 'a1 the old check allowed purchase_order and complete',
         (select ((check_before like '%purchase_order%') and (check_before like '%complete%'))::text from _pre75), 'true'
  union all
  select 'a2 nothing sat on a value this script does not know',
         (select unknown_before::text from _pre75), '0'
  union all
  select 'a3 the trigger was enabled before',
         (select trigger_before::text from _pre75), 'O'
  union all
  select 'b1 no row is left on either retired value',
         (select count(*)::text from vessl.programs
           where declared_stage in ('purchase_order','complete')), '0'
  union all
  -- The migrated rows landed where they were sent, counted as a difference so
  -- this stays true whatever the board holds when it runs.
  select 'b2 production and shipped grew by exactly what was migrated',
         (select (((select count(*) from vessl.programs where declared_stage = 'production') - production_before)
               + ((select count(*) from vessl.programs where declared_stage = 'shipped')    - shipped_before))::text
            from _pre75),
         (select (po_before + complete_before)::text from _pre75)
  union all
  select 'b3 the new check names the six and neither retired value',
         (select ((d like '%quoted%') and (d like '%sampling%') and (d like '%revision%')
              and (d like '%testing%') and (d like '%production%') and (d like '%shipped%')
              and (d not like '%purchase_order%') and (d not like '%complete%'))::text
            from (select pg_get_constraintdef(oid) as d from pg_constraint
                   where conrelid = 'vessl.programs'::regclass
                     and conname = 'programs_declared_stage_check') c), 'true'
  union all
  select 'b4 a card with no stage is still allowed',
         (select (d like '%IS NULL%')::text
            from (select pg_get_constraintdef(oid) as d from pg_constraint
                   where conrelid = 'vessl.programs'::regclass
                     and conname = 'programs_declared_stage_check') c), 'true'
  union all
  -- THE POINT OF DISABLING THE TRIGGER. Every archived row must still carry the
  -- stage date it had before, so days-in-stage survives the migration.
  select 'b5 declared_stage_at did not move on any migrated row',
         (select count(*)::text from jsonb_array_elements((select touched from _arch75)) a
            join vessl.programs p on p.id = (a.value->>'id')::uuid
           where p.declared_stage_at is distinct from (a.value->>'declared_stage_at_before')::timestamptz), '0'
  union all
  -- AND THE POINT OF RE-ENABLING IT. A disabled trigger here would stop every
  -- future stage move being stamped at all.
  select 'b6 the trigger is armed again',
         (select tgenabled::text from pg_trigger
           where tgrelid = 'vessl.programs'::regclass
             and tgname = 'trg_programs_declared_stage_at'), 'O'
  union all
  select 'c1 no program row was added or removed',
         (select ((select count(*) from vessl.programs) - rows_before)::text from _pre75), '0'
  union all
  select 'c2 the cards with no stage are untouched',
         (select count(*)::text from vessl.programs where declared_stage is null),
         (select null_before::text from _pre75)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
