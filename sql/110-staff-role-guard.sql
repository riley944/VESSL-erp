-- 110 -- Staff rows are managed by script only. Closes the staff_profiles role gap.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 110r.
--
-- THE GAP. vessl.staff_profiles has two policies, read_own_profile (SELECT) and
-- staff_only (ALL, using and check vessl.is_staff()), and authenticated holds every
-- table privilege. So any staff login can, from the browser console, update any
-- column of any row -- their own role, anybody else -- and insert or delete rows.
-- No screen in the app does any of that. The only writes are full_name and
-- notifications_enabled on the signed-in person, keyed on their own id.
--
-- WHAT IT DOES. Adds trg_guard_staff_identity, which refuses, for writes made
-- through the app (database role authenticated or anon) --
--   1 any INSERT. Every staff_profiles row makes its address staff to the
--     database (is_staff() only asks that a row exists), whatever its role says,
--     so there is no row the app could add that is not an elevation. Nothing in
--     the app inserts one; people are added by script.
--   2 any DELETE. People are removed by script. Today any staff login could
--     delete any row, the admin row included.
--   3 any UPDATE to a row that is not the signed-in person. Own row is matched
--     the way the Settings page finds it -- the row email equals the sign-in
--     email, ignoring case. A row with no email is nobody.
--   4 any change to role, even on the own row.
--   5 any change to email or auth_user_id. These decide WHOSE row a login reads,
--     so they are part of the role. Without this, a person could put their own
--     address on the admin row and take its role without ever touching role.
--   6 any change to hide_financials.
-- What is left to the app is what it does today -- a person saving their own
-- full_name and notifications_enabled (and can_see_analytics, already refused
-- by the 109 guard). A script run as postgres is not affected, and neither is
-- the sign-in trigger link_staff_on_signin, which sets auth_user_id as its
-- owner postgres.
--
-- WHAT IT DOES NOT DO. No role is changed -- Riley stays the only admin. The
-- policies and grants are not touched.
--
-- MEASURED BEFORE WRITING, 8 Oct 2026. 7 staff rows. admin 1, limited_qc 1,
-- staff 5. The admin is 11da4231-8e38-483e-8dd0-882db902dc30, email length 23.
-- One trigger on the table, 109s trg_guard_can_see_analytics. Neither the
-- function nor the trigger below exists.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre110 on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select string_agg(role || '=' || n::text, ',' order by role)
            from (select coalesce(role, 'null') as role, count(*) as n from vessl.staff_profiles group by 1) x) as roles,
         (select string_agg(id::text || '=' || length(email)::text, ',')
            from vessl.staff_profiles where role = 'admin') as admins,
         (select count(*) from pg_trigger where tgrelid = 'vessl.staff_profiles'::regclass and not tgisinternal) as n_triggers,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'guard_staff_identity') as has_fn;

create or replace function vessl.guard_staff_identity()
returns trigger
language plpgsql
set search_path to 'vessl', 'pg_temp'
as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      raise exception 'staff rows are added by script, not from the app' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      raise exception 'staff rows are removed by script, not from the app' using errcode = '42501';
    end if;
    if coalesce(old.email, '') = ''
       or lower(old.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'another person staff row is changed by script, not from the app' using errcode = '42501';
    end if;
    if new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'staff role, email and sign-in link are set by script, not from the app' using errcode = '42501';
    end if;
    if new.hide_financials is distinct from old.hide_financials then
      raise exception 'hide_financials is set by script, not from the app' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$fn$;

revoke all on function vessl.guard_staff_identity() from public, anon, authenticated;

create trigger trg_guard_staff_identity
  before insert or update or delete on vessl.staff_profiles
  for each row execute function vessl.guard_staff_identity();

-- PROBES. All but c10 act as Matt signed in through the app (a kinguniversal.com
-- identity, staff, so the table policy lets every write reach the row and only
-- the guard can refuse it). c10 acts as postgres, the script path. Each probe
-- runs in its own sub-transaction and is undone, so nothing a probe does
-- survives. A refusal records its SQLSTATE plus guard when the message is the
-- guards own, so a refusal by anything else cannot pass as one.
create temp table _probe110 (k text, v text) on commit drop;
do $probe$
declare
  n integer;
  st text; msg text;
  r text[] := array[]::text[];
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'cd479d49-0662-48f4-9958-f649b7fd8638', 'email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- c1 Matt makes himself admin
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set role = 'admin' where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001', detail = n::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c2 Matt makes Kristy admin
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set role = 'admin' where id = '4917fcc7-acef-4ce7-89dd-df42baa34732';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c3 Matt inserts a new admin row
  begin
    execute 'set local role authenticated';
    insert into vessl.staff_profiles (email, full_name, role) values ('zz110-probe@kinguniversal.com', 'ZZ 110 probe', 'admin');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c4 Matt inserts a new row with the plain staff role
  begin
    execute 'set local role authenticated';
    insert into vessl.staff_profiles (email, full_name, role) values ('zz110-probe@kinguniversal.com', 'ZZ 110 probe', 'staff');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c5 Matt points the admin row at his own sign-in
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set auth_user_id = 'cd479d49-0662-48f4-9958-f649b7fd8638' where id = '11da4231-8e38-483e-8dd0-882db902dc30';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c6 Matt changes his own email
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set email = 'zz110-probe@kinguniversal.com' where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed' when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c7 Matt saves his own name unchanged, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = full_name where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001', detail = n::text;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c8 Matt saves his notifications switch unchanged, the other Settings write
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set notifications_enabled = notifications_enabled where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c9 the profile lookup at login still finds his row
  begin
    execute 'set local role authenticated';
    select count(*) into n from vessl.staff_profiles where lower(email) = 'mattdillon@kinguniversal.com';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'read ' || n::text else st || ' other' end;
  end;

  -- c10 a script run as postgres can still change a role
  begin
    execute 'reset role';
    update vessl.staff_profiles set role = 'admin' where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c11 Matt deletes Kristy
  begin
    execute 'set local role authenticated';
    delete from vessl.staff_profiles where id = '4917fcc7-acef-4ce7-89dd-df42baa34732';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c12 Matt deletes his own row
  begin
    execute 'set local role authenticated';
    delete from vessl.staff_profiles where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c13 Matt changes Kristy name
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = 'ZZ 110 probe' where id = '4917fcc7-acef-4ce7-89dd-df42baa34732';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c14 Matt switches his own hide_financials on
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set hide_financials = true where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c15 Matt changes his own name, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set full_name = 'ZZ 110 probe' where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  -- c16 Matt flips his own notifications switch, as the Settings page does
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set notifications_enabled = not notifications_enabled where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    r := r || case when st = 'P0001' then 'allowed ' || n::text when msg like '%by script%' then st || ' guard' else st || ' other' end;
  end;

  insert into _probe110
    select 'c' || i::text, r[i] from generate_series(1, array_length(r, 1)) as i;
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, 7 rows, admin 1 limited_qc 1 staff 5' as chk,
         (select n_rows::text || '/' || roles from _pre110) as got,
         '7/admin=1,limited_qc=1,staff=5' as want
  union all
  select 'a1 before, the one admin is Riley, email length 23',
         (select admins::text from _pre110), '11da4231-8e38-483e-8dd0-882db902dc30=23'
  union all
  select 'a2 before, one trigger on the table, no guard function',
         (select n_triggers::text || '/' || has_fn::text from _pre110), '1/0'
  union all
  select 'b1 the guard trigger is on the table and enabled',
         (select count(*)::text || '/' || coalesce(max(tgenabled::text), '') from pg_trigger
           where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_staff_identity'),
         '1/O'
  union all
  select 'b2 the 109 guard is still there',
         (select count(*)::text from pg_trigger
           where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_can_see_analytics'),
         '1'
  union all
  select 'b3 roles unchanged, still 7 rows',
         ((select count(*) from vessl.staff_profiles)::text || '/' ||
          (select string_agg(role || '=' || n::text, ',' order by role)
             from (select coalesce(role, 'null') as role, count(*) as n from vessl.staff_profiles group by 1) x)),
         (select n_rows::text || '/' || roles from _pre110)
  union all
  select 'b4 Riley is still the only admin',
         (select string_agg(id::text || '=' || length(email)::text, ',') from vessl.staff_profiles where role = 'admin'),
         '11da4231-8e38-483e-8dd0-882db902dc30=23'
  union all
  select 'b5 the app roles cannot execute the guard function',
         (has_function_privilege('authenticated', 'vessl.guard_staff_identity()', 'execute')::text || '/' ||
          has_function_privilege('anon', 'vessl.guard_staff_identity()', 'execute')::text),
         'false/false'
  union all
  select 'c1 app user cannot make themselves admin',
         (select v::text from _probe110 where k = 'c1'), '42501 guard'
  union all
  select 'c2 app user cannot change somebody else role',
         (select v::text from _probe110 where k = 'c2'), '42501 guard'
  union all
  select 'c3 app user cannot insert an admin row',
         (select v::text from _probe110 where k = 'c3'), '42501 guard'
  union all
  select 'c4 app user cannot insert a staff row either',
         (select v::text from _probe110 where k = 'c4'), '42501 guard'
  union all
  select 'c5 app user cannot point the admin row at their sign-in',
         (select v::text from _probe110 where k = 'c5'), '42501 guard'
  union all
  select 'c6 app user cannot change their own email',
         (select v::text from _probe110 where k = 'c6'), '42501 guard'
  union all
  select 'c7 app user can still save their own name',
         (select v::text from _probe110 where k = 'c7'), 'allowed 1'
  union all
  select 'c8 app user can still save their notifications switch',
         (select v::text from _probe110 where k = 'c8'), 'allowed 1'
  union all
  select 'c9 login lookup still finds their row',
         (select v::text from _probe110 where k = 'c9'), 'read 1'
  union all
  select 'c10 a postgres script can still change a role',
         (select v::text from _probe110 where k = 'c10'), 'allowed 1'
  union all
  select 'c11 app user cannot delete somebody else row',
         (select v::text from _probe110 where k = 'c11'), '42501 guard'
  union all
  select 'c12 app user cannot delete their own row',
         (select v::text from _probe110 where k = 'c12'), '42501 guard'
  union all
  select 'c13 app user cannot change somebody else name',
         (select v::text from _probe110 where k = 'c13'), '42501 guard'
  union all
  select 'c14 app user cannot change their own hide_financials',
         (select v::text from _probe110 where k = 'c14'), '42501 guard'
  union all
  select 'c15 app user can still change their own name',
         (select v::text from _probe110 where k = 'c15'), 'allowed 1'
  union all
  select 'c16 app user can still flip their notifications switch',
         (select v::text from _probe110 where k = 'c16'), 'allowed 1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
