-- 109 -- vessl.staff_profiles.can_see_analytics, true for Riley, Steven and Matt.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 109r.
--
-- WHAT IT DOES
--   1 adds can_see_analytics, boolean, NOT NULL, default false. A new staff row
--     therefore cannot see KUI Vessl Analytics until somebody decides it should.
--   2 sets it true on exactly three rows, by id -- Riley King, Steven King and
--     Matt Dillon. Every other row stays false.
--   3 adds trg_guard_can_see_analytics, which refuses any change to the column
--     made through the app (database role authenticated or anon). Only a script
--     run as postgres can grant or remove it.
--
-- WHY THE GUARD IS NEEDED. Every staff login can update every staff_profiles row
-- today -- the table grants UPDATE to authenticated and its policy is is_staff()
-- for all commands, measured on 7 Oct. Without the guard, anyone could switch the
-- page on for themselves from the browser console. The guard covers this column
-- only and changes nothing else about the table; the wider point (anyone can also
-- change any role) is reported separately and left alone here.
--
-- The app reads the column in the next code commit and shows the page only when
-- it is true. Until that commit ships this column is read by nothing.
--
-- MEASURED BEFORE WRITING, 7 Oct 2026. 7 staff rows. The column, the function and
-- any trigger on staff_profiles do not exist. The three ids below, with their
-- email lengths 23, 24 and 28.
--   riley@      11da4231-8e38-483e-8dd0-882db902dc30  admin
--   steven@     ba9cea01-ff43-4d37-ab81-483a2c94dc32  staff
--   mattdillon@ 6e4f384d-12fe-4999-899f-98822a7eb2c9  staff
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre109 on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'staff_profiles' and column_name = 'can_see_analytics') as has_col,
         (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and not tgisinternal) as n_triggers,
         (select count(*)::text || '/' || coalesce(string_agg(length(email)::text, ',' order by length(email)), '')
            from vessl.staff_profiles
           where id in ('11da4231-8e38-483e-8dd0-882db902dc30', 'ba9cea01-ff43-4d37-ab81-483a2c94dc32', '6e4f384d-12fe-4999-899f-98822a7eb2c9')) as three;

alter table vessl.staff_profiles add column can_see_analytics boolean not null default false;

comment on column vessl.staff_profiles.can_see_analytics is
  'True for the people who may open KUI Vessl Analytics. Set only by a script run as postgres; trg_guard_can_see_analytics refuses changes made through the app.';

update vessl.staff_profiles set can_see_analytics = true
 where id in ('11da4231-8e38-483e-8dd0-882db902dc30', 'ba9cea01-ff43-4d37-ab81-483a2c94dc32', '6e4f384d-12fe-4999-899f-98822a7eb2c9');

create or replace function vessl.guard_can_see_analytics()
returns trigger
language plpgsql
set search_path to 'vessl', 'pg_temp'
as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op = 'INSERT' and new.can_see_analytics)
       or (tg_op = 'UPDATE' and new.can_see_analytics is distinct from old.can_see_analytics) then
      raise exception 'can_see_analytics is set by script, not from the app' using errcode = '42501';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function vessl.guard_can_see_analytics() from public;

create trigger trg_guard_can_see_analytics
  before insert or update on vessl.staff_profiles
  for each row execute function vessl.guard_can_see_analytics();

-- PROBES, as Matt signed in through the app (a kinguniversal.com identity, so the
-- table policy lets the update reach the row). Each runs in its own
-- sub-transaction and is undone, so nothing a probe does survives. A refusal by
-- the guard is SQLSTATE 42501; an allowed update reports its row count.
create temp table _probe109 (k text, v text) on commit drop;
do $probe$
declare
  n integer;
  r1 text; r2 text; r3 text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'cd479d49-0662-48f4-9958-f649b7fd8638', 'email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 Matt switches his own access off
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set can_see_analytics = false where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001', detail = n::text;
  exception when others then
    get stacked diagnostics r1 = returned_sqlstate;
    if r1 = 'P0001' then r1 := 'allowed'; end if;
  end;

  -- p2 Matt switches Kristy on
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set can_see_analytics = true where id = '4917fcc7-acef-4ce7-89dd-df42baa34732';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r2 = returned_sqlstate;
    if r2 = 'P0001' then r2 := 'allowed'; end if;
  end;

  -- p3 Matt saves his own name unchanged, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = full_name where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics r3 = returned_sqlstate;
    if r3 = 'P0001' then r3 := 'allowed ' || n::text; end if;
  end;

  insert into _probe109 values ('p1', r1), ('p2', r2), ('p3', r3);
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 no column and no trigger before, 7 rows' as chk,
         (select has_col::text || '/' || n_triggers::text || '/' || n_rows::text from _pre109) as got,
         '0/0/7' as want
  union all
  select 'a1 the three ids existed, email lengths 23 24 28',
         (select three::text from _pre109), '3/23,24,28'
  union all
  select 'b1 column is boolean, not null, default false',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'staff_profiles' and column_name = 'can_see_analytics'),
         'boolean/NO/false'
  union all
  select 'b2 exactly three rows true, and they are the three ids',
         (select count(*) filter (where can_see_analytics)::text || '/' ||
                 count(*) filter (where can_see_analytics and id in ('11da4231-8e38-483e-8dd0-882db902dc30', 'ba9cea01-ff43-4d37-ab81-483a2c94dc32', '6e4f384d-12fe-4999-899f-98822a7eb2c9'))::text
            from vessl.staff_profiles),
         '3/3'
  union all
  select 'b3 every other row false, still 7 rows',
         (select count(*) filter (where not can_see_analytics)::text || '/' || count(*)::text from vessl.staff_profiles),
         '4/7'
  union all
  select 'b4 the guard trigger is on the table and enabled',
         (select count(*)::text || '/' || coalesce(max(tgenabled::text), '') from pg_trigger
           where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_can_see_analytics'),
         '1/O'
  union all
  select 'c1 app user cannot switch their own access off',
         (select v::text from _probe109 where k = 'p1'), '42501'
  union all
  select 'c2 app user cannot switch somebody else on',
         (select v::text from _probe109 where k = 'p2'), '42501'
  union all
  select 'c3 app user can still save their own name',
         (select v::text from _probe109 where k = 'p3'), 'allowed 1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
