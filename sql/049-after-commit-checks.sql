-- 49 after-commit checks. Run AFTER 49 commits, as a separate statement.
--
-- Everything here rolls back, so it can be run twice.
--
-- WHY THESE ARE NOT IN 49 ITSELF. Script 49 proves the trigger EXISTS and names
-- the right columns. It cannot prove the trigger WORKS, because that takes making
-- it fire -- and a trigger that exists but stamps the wrong thing is exactly the
-- failure this column was added to prevent. A timestamp nobody checked is a
-- number the board will then display with total confidence.
--
-- Five behaviours, one per branch --
--   declaring a stage stamps it
--   touching ANY OTHER COLUMN leaves the stamp alone
--   changing the stage restamps it, to a LATER time
--   clearing the stage nulls it
--   inserting with a stage stamps it
--
-- The second is the whole reason the trigger names UPDATE OF declared_stage.
-- Without that clause, editing an expected ship date would restart the clock on
-- a stage that had not moved, and the board would quietly reset its own ages.
--
-- THE THIRD IS WHY THE TRIGGER USES clock_timestamp AND NOT now. now() is
-- transaction start and is identical for every statement here, so both readings
-- would compare equal and the check would pass without proving anything.

begin;

create temp table _chk49 (what text, ok boolean, detail text) on commit drop;
create temp table _ids49 (label text, id uuid) on commit drop;

do $fn$
declare
  v_id uuid;
  t1 timestamptz;
  t2 timestamptz;
  t3 timestamptz;
begin
  select id into v_id from vessl.programs where declared_stage is null limit 1;
  insert into _ids49 values ('subject', v_id);

  -- 1. DECLARING stamps.
  update vessl.programs set declared_stage = 'inquiry' where id = v_id;
  select declared_stage_at into t1 from vessl.programs where id = v_id;
  insert into _chk49 values ('declaring stamps', t1 is not null, coalesce(t1::text,'null'));

  -- 2. ANOTHER COLUMN does not restamp. Compared against a value the trigger
  --    itself set, so this cannot pass by both sides being something we chose.
  update vessl.programs set expected_ship_date = date '2026-12-25' where id = v_id;
  select declared_stage_at into t2 from vessl.programs where id = v_id;
  insert into _chk49 values ('another column does not restamp', t2 is not distinct from t1, coalesce(t2::text,'null'));

  -- 3. CHANGING the stage restamps, and to a LATER time. Strictly greater, not
  --    merely different -- a trigger writing a fixed value would pass on
  --    difference alone.
  update vessl.programs set declared_stage = 'sampling' where id = v_id;
  select declared_stage_at into t3 from vessl.programs where id = v_id;
  insert into _chk49 values ('changing the stage restamps later', t3 > t1, coalesce(t3::text,'null'));

  -- 4. CLEARING nulls it, rather than leaving a date for a stage that is gone.
  update vessl.programs set declared_stage = null where id = v_id;
  insert into _chk49 values ('clearing nulls the stamp',
    (select declared_stage_at is null from vessl.programs where id = v_id),
    coalesce((select declared_stage_at::text from vessl.programs where id = v_id),'null'));
end;
$fn$;

-- 5. THE INSERT BRANCH, on a product that has no program, so nothing collides.
--    Its own block because a unique violation in the block above would abandon
--    the checks that had already been recorded.
do $fn$
declare v_pid uuid; v_cid uuid; v_new uuid;
begin
  select p.id into v_pid from vessl.products p
   where not exists (select 1 from vessl.programs g where g.product_id = p.id) limit 1;
  select id into v_cid from vessl.companies where type = 'client' limit 1;
  if v_pid is null or v_cid is null then
    insert into _chk49 values ('insert with a stage stamps', null, 'no free product to test with');
    return;
  end if;
  insert into vessl.programs (product_id, client_company_id, declared_stage)
  values (v_pid, v_cid, 'sampling') returning id into v_new;
  insert into _ids49 values ('inserted', v_new);
  insert into _chk49 values ('insert with a stage stamps',
    (select declared_stage_at is not null from vessl.programs where id = v_new),
    coalesce((select declared_stage_at::text from vessl.programs where id = v_new),'null'));
end;
$fn$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 declaring a stage stamps it' as chk,
         (select coalesce(ok::text,'untested') from _chk49 where what = 'declaring stamps') as got,
         'true' as want
  union all
  -- THE ONE THAT MATTERS MOST. Without UPDATE OF, the board resets its own ages.
  select 'a1 editing another column does not restamp',
         (select coalesce(ok::text,'untested') from _chk49 where what = 'another column does not restamp'), 'true'
  union all
  select 'a2 changing the stage restamps to a later time',
         (select coalesce(ok::text,'untested') from _chk49 where what = 'changing the stage restamps later'), 'true'
  union all
  select 'a3 clearing the stage nulls the stamp',
         (select coalesce(ok::text,'untested') from _chk49 where what = 'clearing nulls the stamp'), 'true'
  union all
  select 'a4 inserting with a stage stamps it',
         (select coalesce(ok::text,'untested') from _chk49 where what = 'insert with a stage stamps'), 'true'
  union all
  -- THE SUBJECT ROW IS BACK AS IT STARTED, inside this transaction, before the
  -- rollback takes the rest. Its expected_ship_date is still the test value and
  -- that is fine -- the rollback removes it.
  select 'b1 the subject row has no declared stage again',
         (select count(*)::text from vessl.programs p join _ids49 i on i.id = p.id
           where i.label = 'subject' and p.declared_stage is null and p.declared_stage_at is null), '1'
  union all
  -- One row was inserted to exercise the insert branch, and it is the ONLY new
  -- one. It disappears at the rollback below.
  select 'b2 exactly one test program was inserted',
         (select ((select count(*) from vessl.programs) - 334)::text), '1'
  union all
  select 'b3 and it is the one this file created',
         (select count(*)::text from _ids49 where label = 'inserted'), '1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- Nothing here persists. Every write above was a test of the trigger, including
-- the one inserted program.
rollback;
