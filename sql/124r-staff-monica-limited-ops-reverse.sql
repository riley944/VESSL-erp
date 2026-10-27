-- 124r -- Reverse of 124. Removes the staff profile for Monica, and only it.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. Deletes the one vessl.staff_profiles row whose email is
-- monica@kinguniversal.com (length 24) and whose role is limited_ops. Her
-- sign-in (auth.users), if she has one, is not touched -- without a profile she
-- is no longer staff to the app or to RLS. Tasks or notes that name her
-- address keep it as text.
--
-- GUARDS, before any change.
--   exactly one row matches that email, length and role
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (her row before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre124r on commit drop as
  select
    (select count(*) from vessl.staff_profiles)                                                  as n_rows,
    (select count(*) from vessl.staff_profiles
      where lower(email) = 'monica@kinguniversal.com' and length(email) = 24
        and role = 'limited_ops')                                                                as n_match,
    (select coalesce(string_agg(id::text || ' ' || coalesce(full_name, 'no name'), ', '), 'none')
       from vessl.staff_profiles
      where lower(email) = 'monica@kinguniversal.com' and length(email) = 24)                    as row_before,
    -- Every other row, every column, so b2 can prove none moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s
      where not (lower(s.email) = 'monica@kinguniversal.com' and length(s.email) = 24))         as h_others;

do $guard$
begin
  if (select n_match from _pre124r) <> 1 then
    raise exception 'not exactly one limited_ops row for that email, nothing changed';
  end if;
end
$guard$;

delete from vessl.staff_profiles
 where lower(email) = 'monica@kinguniversal.com' and length(email) = 24 and role = 'limited_ops';

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, her row = ' || (select row_before from _pre124r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 her row is gone',
         (select count(*)::text from vessl.staff_profiles
           where lower(email) = 'monica@kinguniversal.com' and length(email) = 24),
         '0'::text
  union all
  select 'b2 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_others from _pre124r) then 'same' else 'changed' end
            from vessl.staff_profiles s),
         'same'::text
  union all
  select 'b3 one fewer staff row',
         (select count(*)::text from vessl.staff_profiles), (select (n_rows - 1)::text from _pre124r)
  union all
  select 'z0 verification ran, staff rows = ' || (select count(*)::text from vessl.staff_profiles),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
