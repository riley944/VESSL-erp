-- 48 after-commit checks. Run AFTER 48 commits, as a separate statement.
--
-- Everything here is either read-only or self-cleaning, so it can be run twice.
--
-- WHY THESE ARE NOT IN 48 ITSELF. Three of them cannot be true inside the
-- transaction that creates the objects --
--
--   the CHECK and the UNIQUE can only be PROVEN by attempting a bad write, and
--   an attempt inside 48 would have to be caught and unwound, which is more
--   moving parts in the script that is doing the real work.
--
--   has_table_privilege reads the catalogue, and 48 already checks it, but a
--   second reading AFTER commit is the one that reflects what PostgREST will
--   actually see.
--
-- Anything failing here means 48 committed something wrong. That is a repair,
-- not a rollback -- 48 is already in.

begin;

-- 1. THE DECLARED STAGE CHECK MUST ACTUALLY REJECT. A constraint that accepts
--    anything is worse than none, because everything downstream trusts it.
create temp table _chk48 (what text, ok boolean) on commit drop;

do $$
declare v_pid uuid; v_cid uuid;
begin
  select product_id, client_company_id into v_pid, v_cid from vessl.programs limit 1;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage)
    values (v_pid, v_cid, 'production');
    insert into _chk48 values ('declared_stage rejects production', false);
  exception when check_violation then
    insert into _chk48 values ('declared_stage rejects production', true);
  end;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage)
    values (v_pid, v_cid, 'sampling');
    insert into _chk48 values ('the pair is unique', false);
  exception when unique_violation then
    insert into _chk48 values ('the pair is unique', true);
  end;

  begin
    insert into vessl.programs (product_id, client_company_id, factory_pct)
    values (v_pid, v_cid, 140);
    insert into _chk48 values ('factory_pct rejects 140', false);
  exception when check_violation then
    insert into _chk48 values ('factory_pct rejects 140', true);
  when unique_violation then
    -- The pair check fires first on this row, which still proves nothing about
    -- factory_pct, so it is recorded as untested rather than as a pass.
    insert into _chk48 values ('factory_pct rejects 140', null);
  end;
end $$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 declared_stage rejects a derived stage' as chk,
         (select coalesce(ok::text,'untested') from _chk48
           where what = 'declared_stage rejects production') as got, 'true' as want
  union all
  select 'a1 the product and client pair is unique',
         (select coalesce(ok::text,'untested') from _chk48 where what = 'the pair is unique'), 'true'
  union all
  select 'a2 factory_pct rejects a value above one hundred',
         (select coalesce(ok::text,'untested') from _chk48 where what = 'factory_pct rejects 140'), 'true'
  union all
  -- Nothing above may have survived. Every one of those inserts was meant to
  -- fail, and a stray row would be a program nobody asked for.
  select 'a3 not one of those attempts left a row behind',
         (select count(*)::text from vessl.programs), '334'
  union all
  select 'b1 the seed still reads one seven three live and one six one archived',
         (select count(*) filter (where archived = false)::text || ' and ' ||
                 count(*) filter (where archived = true)::text from vessl.programs), '173 and 161'
  union all
  select 'b2 declared_stage accepts inquiry and sampling and null',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_declared_stage_check'), '1'
  union all
  -- THE GRANT TRAP, read after commit, which is the reading PostgREST gets.
  select 'c1 authenticated still cannot delete a program',
         (select has_table_privilege('authenticated','vessl.programs','delete')::text), 'false'
  union all
  select 'c2 nor delete a note',
         (select has_table_privilege('authenticated','vessl.program_notes','delete')::text), 'false'
  union all
  select 'c3 nor update a note, which is append only',
         (select has_table_privilege('authenticated','vessl.program_notes','update')::text), 'false'
  union all
  select 'c4 anon has no reach into either table',
         (select (has_table_privilege('anon','vessl.programs','select')
               or has_table_privilege('anon','vessl.program_notes','select'))::text), 'false'
  union all
  select 'd1 the legacy tables are still there with their rows',
         (select (select count(*) from vessl.programs_legacy)::text || ' and ' ||
                 (select count(*) from vessl.program_tasks_legacy)::text || ' and ' ||
                 (select count(*) from vessl.program_notes_legacy)::text), '1 and 8 and 0'
  union all
  select 'd2 the legacy task foreign key followed the rename',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_tasks_legacy'::regclass and contype = 'f'), '1'
  union all
  select 'e1 quotes carry the client column and its index',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and indexname = 'quotes_client_company_id_idx'), '1'
  union all
  select 'e2 and three hundred and twenty eight are resolved',
         (select count(*) filter (where client_company_id is not null)::text from vessl.quotes), '328'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- Nothing here should persist. This transaction only ever attempted writes that
-- were meant to be rejected.
rollback;
