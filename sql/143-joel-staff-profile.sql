-- 143 -- Joel Harris gets a staff profile, role staff, analytics on.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 143r.
--
-- READY TO RUN. Unlike the usual rehearsal form, this file ends in commit. A
-- failed guard or a failed check raises an error before the commit line, so the
-- transaction aborts and nothing is written; the commit only lands on a pass.
--
-- WHAT IT DOES. Inserts one vessl.staff_profiles row --
--   email joel@kinguniversal.com (length 22), full_name Joel Harris (length 11),
--   role staff, hide_financials false, can_see_analytics true,
--   notifications_enabled true. job_title stays empty. auth_user_id is his
--   sign-in if one already exists (none on 2 Nov), else empty -- it then fills
--   itself the first time he signs in, through the link_staff_user trigger on
--   auth.users, as it did for everyone else.
-- No other row, no other table.
--
-- NOT A DATA LOCK. A staff profile passes vessl.is_staff(), so RLS lets him
-- read what any staff member reads, and can_see_analytics opens Analytics.
--
-- AS postgres the two staff guards (110 trg_guard_staff_identity, 109
-- trg_guard_can_see_analytics) do not apply -- they govern writes from the app.
--
-- MEASURED 2 Nov (read-only). 8 staff rows (1 admin, 7 staff), 4 with
-- analytics; no staff row and no auth.users row for this email.
--
-- GUARDS, before any change.
--   no staff row has this email, any case
--   the email is the 22 characters expected
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the row count before) and z0 (his row
-- after). Any failed check raises before the commit instead of showing a row.

begin;

create temp table _in143 on commit drop as
  select 'joel@kinguniversal.com'::text as email,
         'Joel Harris'::text as full_name;

create temp table _pre143 on commit drop as
  select
    (select count(*) from vessl.staff_profiles)                                                  as n_rows,
    (select count(*) from vessl.staff_profiles where can_see_analytics)                          as n_analytics,
    (select count(*) from vessl.staff_profiles s, _in143 i where lower(s.email) = lower(i.email)) as n_match,
    (select length(email) from _in143)                                                           as email_len,
    (select u.id from auth.users u, _in143 i where lower(u.email) = lower(i.email) limit 1)      as auth_id,
    -- Every existing row, every column, so b4 can prove none moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s)                                                              as h_rows;

do $guard$
begin
  if (select email_len from _pre143) <> 22 then
    raise exception 'the email is not the 22 characters expected, nothing changed';
  end if;
  if (select n_match from _pre143) <> 0 then
    raise exception 'a staff row with this email already exists, nothing changed';
  end if;
end
$guard$;

create temp table _new143 (id uuid) on commit drop;

with ins as (
  insert into vessl.staff_profiles
         (email, full_name, role, hide_financials, can_see_analytics, notifications_enabled, auth_user_id)
    select i.email, i.full_name, 'staff', false, true, true, p.auth_id
      from _in143 i cross join _pre143 p
  returning id
)
insert into _new143 (id) select id from ins;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check; the block after the select raises on one, so the commit never lands.
create temp table _chk143 on commit drop as
select * from (
  select 'a0 before, staff rows = ' || (select n_rows::text from _pre143) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 one new row, his email and name, role staff',
         (select count(*)::text || '/' || coalesce(string_agg(s.role, ''), 'none')
                 || '/' || coalesce(bool_and(s.full_name = i.full_name and length(s.full_name) = 11
                                             and s.email = i.email and length(s.email) = 22)::text, 'none')
            from vessl.staff_profiles s join _new143 n on n.id = s.id cross join _in143 i),
         '1/staff/true'::text
  union all
  select 'b2 flags -- financials shown, analytics on, notifications on, no job title',
         (select coalesce(s.hide_financials::text, 'null') || '/' || s.can_see_analytics::text || '/'
                 || s.notifications_enabled::text || '/' || (s.job_title is null)::text
            from vessl.staff_profiles s join _new143 n on n.id = s.id),
         'false/true/true/true'::text
  union all
  select 'b3 linked to his sign-in if he has one, else empty',
         (select (s.auth_user_id is not distinct from p.auth_id)::text
            from vessl.staff_profiles s join _new143 n on n.id = s.id cross join _pre143 p),
         'true'::text
  union all
  select 'b4 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_rows from _pre143) then 'same' else 'changed' end
            from vessl.staff_profiles s where s.id not in (select id from _new143)),
         'same'::text
  union all
  select 'b5 one more staff row, one more with analytics',
         (select count(*)::text || '/' || count(*) filter (where can_see_analytics)::text
            from vessl.staff_profiles),
         (select (n_rows + 1)::text || '/' || (n_analytics + 1)::text from _pre143)
  union all
  select 'z0 verification ran, new row ' || (select s.id::text || ' ' || s.full_name || ' ' || s.role
                                                || ' linked ' || (s.auth_user_id is not null)::text
                                                from vessl.staff_profiles s join _new143 n on n.id = s.id),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%';

do $verify$
declare
  bad text;
begin
  select string_agg(chk || ' got ' || coalesce(got, 'null') || ' want ' || want, ' | ')
    into bad from _chk143 where chk like 'b%';
  if bad is not null then
    raise exception 'a check failed, nothing committed -- %', bad;
  end if;
end
$verify$;

select * from _chk143 order by chk;

commit;
