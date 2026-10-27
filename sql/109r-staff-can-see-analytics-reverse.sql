-- 109r -- Reverse 109. Drops can_see_analytics and its guard.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 109. One transaction.
--
-- WHAT IT DOES. Drops trg_guard_can_see_analytics, vessl.guard_can_see_analytics()
-- and the column vessl.staff_profiles.can_see_analytics. No other column and no
-- row is touched.
--
-- TAKE THE CODE THAT READS THE COLUMN OUT FIRST. Once the app checks it, dropping
-- the column makes the staff profile lookup fail, which the app treats as an
-- unknown role.
--
-- GUARD. The column, the function and the trigger all exist, which proves 109 ran.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre109r on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'staff_profiles' and column_name = 'can_see_analytics') as has_col,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'guard_can_see_analytics') as has_fn,
         (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_can_see_analytics') as has_trg,
         (select count(*) from vessl.staff_profiles) as n_rows;

do $guard$
begin
  if (select has_col from _pre109r) <> 1 or (select has_fn from _pre109r) <> 1 or (select has_trg from _pre109r) <> 1 then
    raise exception 'can_see_analytics, its function or its trigger is missing, so 109 is not in place, nothing changed';
  end if;
end
$guard$;

drop trigger trg_guard_can_see_analytics on vessl.staff_profiles;
drop function vessl.guard_can_see_analytics();
alter table vessl.staff_profiles drop column can_see_analytics;

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 column, function and trigger all existed' as chk,
         (select has_col::text || '/' || has_fn::text || '/' || has_trg::text from _pre109r) as got,
         '1/1/1' as want
  union all
  select 'b1 all three are gone',
         ((select count(*) from information_schema.columns
            where table_schema = 'vessl' and table_name = 'staff_profiles' and column_name = 'can_see_analytics')::text
          || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'vessl' and p.proname = 'guard_can_see_analytics')::text
          || '/' || (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_can_see_analytics')::text),
         '0/0/0'
  union all
  select 'b2 same number of staff rows',
         ((select count(*) from vessl.staff_profiles)::text), (select n_rows::text from _pre109r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
