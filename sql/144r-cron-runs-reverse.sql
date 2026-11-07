-- 144r -- Reverse of 144. Drops cron_runs and its two functions.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. Drops vessl.cron_run_finish, vessl.cron_run_start and the table
-- vessl.cron_runs with its policy and index. Every recorded run is lost -- a0
-- counts them. The code in lib/cronRuns.js keeps working without them (it
-- only skips the record), so taking the code out first is tidy, not required.
--
-- GUARDS, before any change.
--   144 is committed -- the table and both functions exist
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the runs lost) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre144r on commit drop as
  select
    (select count(*) from pg_class
      where relnamespace = 'vessl'::regnamespace and relname = 'cron_runs' and relkind = 'r')       as n_table,
    (select count(*) from pg_proc
      where pronamespace = 'vessl'::regnamespace and proname in ('cron_run_start', 'cron_run_finish')) as n_fn;

do $guard$
begin
  if (select n_table from _pre144r) <> 1 or (select n_fn from _pre144r) <> 2 then
    raise exception '144 is not committed, nothing changed';
  end if;
end
$guard$;

create temp table _lost144r on commit drop as
  select count(*) as n_runs, max(started_at) as last_run from vessl.cron_runs;

drop function vessl.cron_run_finish(uuid, boolean, integer, jsonb);
drop function vessl.cron_run_start(text, text, text);
drop table vessl.cron_runs;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, runs lost = ' || (select n_runs::text || ', last ' || coalesce(last_run::text, 'none') from _lost144r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 table gone',
         (select count(*)::text from pg_class
           where relnamespace = 'vessl'::regnamespace and relname = 'cron_runs'),
         '0'::text
  union all
  select 'b2 functions gone',
         (select count(*)::text from pg_proc
           where pronamespace = 'vessl'::regnamespace and proname in ('cron_run_start', 'cron_run_finish')),
         '0'::text
  union all
  select 'z0 verification ran',
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
