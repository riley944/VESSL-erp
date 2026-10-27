-- 132 -- Monica Harris may open KUI Vessl Analytics.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 132r.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.can_see_analytics
-- goes from false to true on the row with id 3ac9f7fb-22dc-4638-8d3f-d3deef15853b
-- (Monica Harris, monica@kinguniversal.com). Her role, hide_financials and
-- notifications_enabled are not touched. The per-person grant 109 made for Riley,
-- Steven and Matt, for one more person.
--
-- WHY A SCRIPT. trg_guard_can_see_analytics (109) refuses any change to the column
-- made through the app (database role authenticated or anon). This script runs as
-- postgres, which the guard lets through, so no trigger is disabled. The 110 guard
-- governs role and identity columns, and this script changes neither.
--
-- WHAT IT GIVES HER. The Analytics sidebar item and page, which the app shows only
-- when this column is true. Nothing else -- RLS does not read the column.
--
-- MEASURED BEFORE WRITING, 23 Oct 2026. 8 staff rows -- 1 admin, 7 staff (130 has
-- been run), 3 with analytics. Monica, by id, email length 24, role staff,
-- can_see_analytics false, hide_financials false, notifications_enabled true,
-- linked to auth user 1a3e71a9-66e7-4df6-bc13-1907b89848f7.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre132 on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from vessl.staff_profiles where can_see_analytics) as n_analytics,
         (select count(*) from vessl.staff_profiles where lower(email) = 'monica@kinguniversal.com') as n_match,
         (select role || '/' || length(email)::text || '/' || can_see_analytics::text || '/' || hide_financials::text || '/' || notifications_enabled::text
            from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica,
         (select md5((to_jsonb(sp) - 'can_see_analytics')::text) from vessl.staff_profiles sp
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as others;

do $guard$
begin
  if (select n_match from _pre132) <> 1 then
    raise exception 'not exactly one staff row for that email, so nothing changed';
  end if;
  if (select monica from _pre132) is distinct from 'staff/24/false/false/true' then
    raise exception 'Monica row is not as measured on 23 Oct, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set can_see_analytics = true
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b' and can_see_analytics = false;

-- PROBES, as Monica signed in through the app. Each runs in its own sub-transaction
-- and is undone, so nothing a probe does survives. A refusal by the 109 guard is
-- SQLSTATE 42501; an allowed update reports its row count.
create temp table _probe132 (k text, v text) on commit drop;
do $probe$
declare
  n integer;
  r1 text; r2 text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '1a3e71a9-66e7-4df6-bc13-1907b89848f7', 'email', 'monica@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 Monica tries to switch her own analytics off from the app
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set can_see_analytics = false where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r1 = returned_sqlstate;
    if r1 = 'P0001' then r1 := 'allowed'; end if;
  end;

  -- p2 Monica saves her own name unchanged, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = full_name where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r2 = returned_sqlstate;
    if r2 = 'P0001' then r2 := 'allowed ' || n::text; end if;
  end;

  insert into _probe132 values ('p1', r1), ('p2', r2);
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, 8 rows, 3 with analytics, one row for the email' as chk,
         (select n_rows::text || '/' || n_analytics::text || '/' || n_match::text from _pre132) as got,
         '8/3/1' as want
  union all
  select 'a1 before, Monica role, email length, analytics, financials, notifications',
         (select monica::text from _pre132), 'staff/24/false/false/true'
  union all
  select 'b1 Monica can now see analytics and is still staff',
         (select can_see_analytics::text || '/' || role from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'true/staff'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'can_see_analytics')::text) = (select monica_rest from _pre132) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre132) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b4 still 8 rows, now 4 with analytics',
         (select count(*)::text || '/' || count(*) filter (where can_see_analytics)::text from vessl.staff_profiles),
         '8/4'
  union all
  select 'c1 Monica cannot change her analytics from the app',
         (select v::text from _probe132 where k = 'p1'), '42501'
  union all
  select 'c2 Monica can still save her own name',
         (select v::text from _probe132 where k = 'p2'), 'allowed 1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
