-- 124 -- Monica gets a staff profile, role limited_ops.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 124r.
--
-- BEFORE RUNNING, put her surname in the one line marked SURNAME below. The
-- guard refuses to run while the placeholder is still there.
--
-- WHAT IT DOES. Inserts one vessl.staff_profiles row --
--   email monica@kinguniversal.com (length 24), full_name Monica and her
--   surname, role limited_ops, can_see_analytics false. Every other column takes
--   its default -- notifications_enabled true, hide_financials false, job_title
--   and auth_user_id empty. auth_user_id fills itself the first time she signs
--   in, through the sign-in link trigger, as it did for everyone else.
-- No other row, no other table.
--
-- limited_ops is a page list in app/page.jsx ROLE_PAGES (the commit titled
-- feat, limited_ops role for Monica) -- every page but Purchase Orders, Sales Orders
-- and Analytics. Run this once that code is live, or she signs in to a role the
-- app does not know, which it treats as unrestricted.
--
-- NOT A DATA LOCK. A staff profile passes vessl.is_staff(), so RLS lets her
-- read what any staff member reads. The role hides pages; it does not make
-- orders private.
--
-- AS postgres the two staff guards (110 trg_guard_staff_identity, 109
-- trg_guard_can_see_analytics) do not apply -- they govern writes from the app.
--
-- GUARDS, before any change.
--   the surname placeholder has been replaced
--   no staff row has this email, any case
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the row count before) and z0 (her row
-- after), on the rehearsal and again on the commit. Any b row is a failed
-- check. Zero rows means the query did not run.

begin;

create temp table _in124 on commit drop as
  select 'monica@kinguniversal.com'::text as email,
         'Monica <SURNAME>'::text as full_name;   -- SURNAME -- replace <SURNAME>, keep the quotes

create temp table _pre124 on commit drop as
  select
    (select count(*) from vessl.staff_profiles)                                                  as n_rows,
    (select count(*) from vessl.staff_profiles s, _in124 i where lower(s.email) = lower(i.email)) as n_match,
    (select position('<' in full_name) + position('>' in full_name) from _in124)                 as n_placeholder,
    (select length(email) from _in124)                                                           as email_len,
    -- Every existing row, every column, so b3 can prove none moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s)                                                              as h_rows;

do $guard$
begin
  if (select n_placeholder from _pre124) <> 0 then
    raise exception 'the surname placeholder is still in the script, nothing changed';
  end if;
  if (select email_len from _pre124) <> 24 then
    raise exception 'the email is not the 24 characters expected, nothing changed';
  end if;
  if (select n_match from _pre124) <> 0 then
    raise exception 'a staff row with this email already exists, nothing changed';
  end if;
end
$guard$;

create temp table _new124 (id uuid) on commit drop;

with ins as (
  insert into vessl.staff_profiles (email, full_name, role, can_see_analytics)
    select email, full_name, 'limited_ops', false from _in124
  returning id
)
insert into _new124 (id) select id from ins;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, staff rows = ' || (select n_rows::text from _pre124) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 one new row, her email, role limited_ops, no analytics, the name given',
         (select count(*)::text || '/' || coalesce(string_agg(s.role || '/' || s.can_see_analytics::text, ''), 'none')
                 || '/' || coalesce(bool_and(s.full_name = i.full_name and length(s.email) = 24)::text, 'none')
            from vessl.staff_profiles s join _new124 n on n.id = s.id cross join _in124 i),
         '1/limited_ops/false/true'::text
  union all
  select 'b2 defaults on the new row -- notifications on, financials shown, not yet linked',
         (select s.notifications_enabled::text || '/' || coalesce(s.hide_financials::text, 'null') || '/'
                 || (s.auth_user_id is null)::text
            from vessl.staff_profiles s join _new124 n on n.id = s.id),
         'true/false/true'::text
  union all
  select 'b3 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_rows from _pre124) then 'same' else 'changed' end
            from vessl.staff_profiles s where s.id not in (select id from _new124)),
         'same'::text
  union all
  select 'b4 one more staff row',
         (select count(*)::text from vessl.staff_profiles), (select (n_rows + 1)::text from _pre124)
  union all
  select 'z0 verification ran, new row ' || (select s.id::text || ' ' || s.full_name || ' ' || s.role
                                                from vessl.staff_profiles s join _new124 n on n.id = s.id),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
