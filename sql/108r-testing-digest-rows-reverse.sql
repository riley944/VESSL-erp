-- 108r -- Reverse 108. The testing email loses its function.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 108. One transaction.
--
-- WHAT IT DOES. Drops vessl.testing_digest_rows(). Nothing else. No table, row or
-- table grant is touched. USAGE on the vessl schema stays with service_role,
-- because rfq_digest_rows (script 21) needs it, and c1 asserts that function
-- still works for service_role afterwards.
--
-- AFTER THIS the testing email route answers 502, could not read the testing
-- list, on every call. Take its cron entry out of vercel.json first, or the
-- Monday run fails every week.
--
-- GUARD. The function exists, which proves 108 ran.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a, b or c row is a failed check.

begin;

create temp table _pre108r on commit drop as
  select (select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows') as fn_before;

do $guard$
begin
  if (select fn_before from _pre108r) <> 1 then
    raise exception 'vessl.testing_digest_rows is not there, so 108 is not in place, nothing changed';
  end if;
end
$guard$;

drop function vessl.testing_digest_rows();

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 the function existed before this script' as chk,
         (select fn_before::text from _pre108r) as got, '1' as want
  union all
  select 'b1 the function is gone',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows'), '0'
  union all
  select 'c1 service_role keeps schema usage and rfq_digest_rows',
         (has_schema_privilege('service_role', 'vessl', 'USAGE')::text || '/' ||
          has_function_privilege('service_role', 'vessl.rfq_digest_rows()', 'EXECUTE')::text),
         'true/true'
  union all
  select 'c2 service_role still reads none of the three tables',
         (has_table_privilege('service_role', 'vessl.products', 'SELECT')::text || '/' ||
          has_table_privilege('service_role', 'vessl.test_reports', 'SELECT')::text || '/' ||
          has_table_privilege('service_role', 'vessl.companies', 'SELECT')::text),
         'false/false/false'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
