-- 110r -- Reverse 110. Drops trg_guard_staff_identity and its function.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 110. One transaction.
--
-- WHAT IT DOES. Drops trg_guard_staff_identity and vessl.guard_staff_identity().
-- No row, column, policy or grant is touched, and the 109 guard on
-- can_see_analytics stays. Afterwards any staff login can again change any
-- column of any row (role, email, sign-in link, hide_financials, somebody else
-- name) and insert or delete rows, exactly as before 110.
--
-- GUARD. The function and the trigger both exist, which proves 110 ran.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre110r on commit drop as
  select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'guard_staff_identity') as has_fn,
         (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_staff_identity') as has_trg,
         (select count(*) from vessl.staff_profiles) as n_rows,
         (select string_agg(id::text || '=' || coalesce(role, 'null'), ',' order by id) from vessl.staff_profiles) as roles;

do $guard$
begin
  if (select has_fn from _pre110r) <> 1 or (select has_trg from _pre110r) <> 1 then
    raise exception 'guard_staff_identity or its trigger is missing, so 110 is not in place, nothing changed';
  end if;
end
$guard$;

drop trigger trg_guard_staff_identity on vessl.staff_profiles;
drop function vessl.guard_staff_identity();

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 function and trigger both existed' as chk,
         (select has_fn::text || '/' || has_trg::text from _pre110r) as got,
         '1/1' as want
  union all
  select 'b1 both are gone',
         ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'vessl' and p.proname = 'guard_staff_identity')::text
          || '/' || (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_staff_identity')::text),
         '0/0'
  union all
  select 'b2 the 109 guard is still there',
         (select count(*)::text from pg_trigger
           where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_can_see_analytics'),
         '1'
  union all
  select 'b3 same rows, same roles',
         ((select count(*) from vessl.staff_profiles)::text || '/' ||
          (select string_agg(id::text || '=' || coalesce(role, 'null'), ',' order by id) from vessl.staff_profiles)),
         (select n_rows::text || '/' || roles from _pre110r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
