-- 130 -- Monica Harris becomes staff, so she sees every page except KUI Vessl Analytics.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 130r.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.role goes
-- from limited_ops to staff on the row with id 3ac9f7fb-22dc-4638-8d3f-d3deef15853b
-- (Monica Harris, monica@kinguniversal.com). can_see_analytics stays false, so the
-- Analytics page stays hidden from her. hide_financials and notifications_enabled
-- are not touched. Modelled on 111 (Jenn Moore, limited_qc to staff).
--
-- WHY A SCRIPT. Since 110, trg_guard_staff_identity refuses any role change made
-- through the app (database role authenticated or anon). This script runs as
-- postgres, which both guards let through, so no trigger is disabled. The 109 guard
-- only fires when can_see_analytics changes, and this script does not change it.
--
-- WHAT STAFF GIVES HER, the same as every other staff member. Every page except
-- Analytics -- adding Purchase Orders and Sales Orders (and their detail pages) and
-- Company Banking to what limited_ops showed. Order exports with prices, costs and
-- margins (ORDER_MONEY_ROLES). And, in the database, write access to
-- vessl.kui_settings (company details and bank details) through can_write_settings,
-- which allows admin and staff only and today is false for her. No RLS policy names
-- limited_ops; every table already reads her as staff through is_staff.
--
-- MEASURED BEFORE WRITING, 23 Oct 2026. 8 staff rows -- 1 admin, 6 staff, 1
-- limited_ops. Monica, by id, email length 24, name length 13, role limited_ops,
-- can_see_analytics false, hide_financials false, notifications_enabled true,
-- linked to auth user 1a3e71a9-66e7-4df6-bc13-1907b89848f7.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre130 on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from vessl.staff_profiles where role = 'limited_ops') as n_limited,
         (select count(*) from vessl.staff_profiles where lower(email) = 'monica@kinguniversal.com') as n_match,
         (select role || '/' || length(email)::text || '/' || can_see_analytics::text || '/' || hide_financials::text || '/' || notifications_enabled::text
            from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica,
         (select md5((to_jsonb(sp) - 'role')::text) from vessl.staff_profiles sp
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as others;

do $guard$
begin
  if (select n_match from _pre130) <> 1 then
    raise exception 'not exactly one staff row for that email, so nothing changed';
  end if;
  if (select monica from _pre130) is distinct from 'limited_ops/24/false/false/true' then
    raise exception 'Monica row is not as measured on 23 Oct, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set role = 'staff'
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b' and role = 'limited_ops';

-- PROBES, as Monica signed in through the app. Each runs in its own sub-transaction
-- and is undone, so nothing a probe does survives. A refusal by the 110 guard is
-- SQLSTATE 42501; an allowed update reports its row count.
create temp table _probe130 (k text, v text) on commit drop;
do $probe$
declare
  n integer;
  r1 text; r2 text; r3 text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '1a3e71a9-66e7-4df6-bc13-1907b89848f7', 'email', 'monica@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 Monica tries to change her own role from the app
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set role = 'admin' where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r1 = returned_sqlstate;
    if r1 = 'P0001' then r1 := 'allowed'; end if;
  end;

  -- p2 Monica may now write company settings, as every staff member may
  r2 := vessl.can_write_settings()::text;

  -- p3 Monica saves her own name unchanged, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = full_name where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r3 = returned_sqlstate;
    if r3 = 'P0001' then r3 := 'allowed ' || n::text; end if;
  end;

  insert into _probe130 values ('p1', r1), ('p2', r2), ('p3', r3);
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, 8 rows, one limited_ops, one row for the email' as chk,
         (select n_rows::text || '/' || n_limited::text || '/' || n_match::text from _pre130) as got,
         '8/1/1' as want
  union all
  select 'a1 before, Monica role, email length, analytics, financials, notifications',
         (select monica::text from _pre130), 'limited_ops/24/false/false/true'
  union all
  select 'b1 Monica is now staff and still cannot see analytics',
         (select role || '/' || can_see_analytics::text from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'staff/false'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'role')::text) = (select monica_rest from _pre130) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre130) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b4 still 8 rows, none limited_ops, 7 staff',
         (select count(*)::text || '/' || count(*) filter (where role = 'limited_ops')::text || '/' || count(*) filter (where role = 'staff')::text
            from vessl.staff_profiles),
         '8/0/7'
  union all
  select 'c1 Monica cannot change her role from the app',
         (select v::text from _probe130 where k = 'p1'), '42501'
  union all
  select 'c2 Monica can now write company settings',
         (select v::text from _probe130 where k = 'p2'), 'true'
  union all
  select 'c3 Monica can still save her own name',
         (select v::text from _probe130 where k = 'p3'), 'allowed 1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
