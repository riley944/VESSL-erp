-- 111 -- Jenn Moore becomes staff, so she sees every page except KUI Vessl Analytics.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 111r.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.role goes
-- from limited_qc to staff on the row with id 7061815f-7791-4e1f-9bad-06ecdbdde9c1
-- (Jenn Moore). can_see_analytics stays false, so the Analytics page stays hidden
-- from her. hide_financials and notifications_enabled are not touched.
--
-- WHY A SCRIPT. Since 110, trg_guard_staff_identity refuses any role change made
-- through the app (database role authenticated or anon). This script runs as
-- postgres, which both guards let through, so no trigger is disabled. The 109 guard
-- only fires when can_see_analytics changes, and this script does not change it.
--
-- WHAT STAFF GIVES HER, the same as every other staff member. Every page except
-- Analytics -- including Quotes, Sales and Purchase Orders, Companies, Inventory and
-- KUI Banking. Order exports with prices, costs and margins. Creating products and
-- deleting codes. And, in the database, write access to vessl.kui_settings (company
-- details and bank details) through can_write_settings, which today is false for her.
-- No RLS policy names limited_qc; every other table already treats her as staff.
--
-- MEASURED BEFORE WRITING, 10 Oct 2026. 7 staff rows, exactly one of them
-- limited_qc. Jenn, by id, email length 22, role limited_qc, can_see_analytics
-- false, hide_financials false, notifications_enabled true.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre111 on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from vessl.staff_profiles where role = 'limited_qc') as n_limited,
         (select role || '/' || length(email)::text || '/' || can_see_analytics::text || '/' || hide_financials::text || '/' || notifications_enabled::text
            from vessl.staff_profiles where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as jenn,
         (select md5((to_jsonb(sp) - 'role')::text) from vessl.staff_profiles sp
           where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as jenn_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as others;

do $guard$
begin
  if (select jenn from _pre111) is distinct from 'limited_qc/22/false/false/true' then
    raise exception 'Jenn row is not as measured on 10 Oct, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set role = 'staff'
 where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1' and role = 'limited_qc';

-- PROBES, as Jenn signed in through the app. Each runs in its own sub-transaction
-- and is undone, so nothing a probe does survives. A refusal by the 110 guard is
-- SQLSTATE 42501; an allowed update reports its row count.
create temp table _probe111 (k text, v text) on commit drop;
do $probe$
declare
  n integer;
  r1 text; r2 text; r3 text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 Jenn tries to change her own role from the app
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set role = 'admin' where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r1 = returned_sqlstate;
    if r1 = 'P0001' then r1 := 'allowed'; end if;
  end;

  -- p2 Jenn may now write company settings, as every staff member may
  r2 := vessl.can_write_settings()::text;

  -- p3 Jenn saves her own name unchanged, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = full_name where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r3 = returned_sqlstate;
    if r3 = 'P0001' then r3 := 'allowed ' || n::text; end if;
  end;

  insert into _probe111 values ('p1', r1), ('p2', r2), ('p3', r3);
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, 7 rows and one limited_qc' as chk,
         (select n_rows::text || '/' || n_limited::text from _pre111) as got,
         '7/1' as want
  union all
  select 'a1 before, Jenn role, email length, analytics, financials, notifications',
         (select jenn::text from _pre111), 'limited_qc/22/false/false/true'
  union all
  select 'b1 Jenn is now staff and still cannot see analytics',
         (select role || '/' || can_see_analytics::text from vessl.staff_profiles where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'staff/false'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'role')::text) = (select jenn_rest from _pre111) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre111) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'same'
  union all
  select 'b4 still 7 rows, none limited_qc',
         (select count(*)::text || '/' || count(*) filter (where role = 'limited_qc')::text from vessl.staff_profiles),
         '7/0'
  union all
  select 'c1 Jenn cannot change her role from the app',
         (select v::text from _probe111 where k = 'p1'), '42501'
  union all
  select 'c2 Jenn can now write company settings',
         (select v::text from _probe111 where k = 'p2'), 'true'
  union all
  select 'c3 Jenn can still save her own name',
         (select v::text from _probe111 where k = 'p3'), 'allowed 1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
