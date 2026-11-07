-- 144 -- A record of every scheduled run -- cron_runs.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 144r.
-- The code that writes it (lib/cronRuns.js, around GET /api/tracking/refresh,
-- /api/rfq/digest and /api/testing/digest) never fails a run when this is
-- missing -- it only skips the record -- so the order does not matter, but run
-- this first so the first run after the deploy is recorded.
--
-- WHY. The daily tracking refresh wrote nothing from 31 Oct to 3 Nov and
-- nothing could say why -- the routes report only in their HTTP response, and
-- Vercel kept no logs. From now on each run leaves a row.
--
-- WHAT IT DOES.
--   Table vessl.cron_runs, one row per authorised run -- route (CHECK, the three
--   paths), started_at, finished_at, ok, http_status, due, checked, moved,
--   failed (jsonb, the refs that failed), sent (the digests), error, detail
--   (the route result as jsonb, without any html), deployment (the commit),
--   user_agent. A row with started_at and no finished_at is a run that timed
--   out or crashed. uuid id, so no sequence to grant.
--   RLS on. Staff (vessl.is_staff()) read every row; nobody writes from the app
--   -- authenticated keeps select only, anon nothing.
--   vessl.cron_run_start(route, deployment, user_agent) returns the new id and
--   first deletes rows started over 90 days ago. vessl.cron_run_finish(id, ok,
--   http_status, detail) fills the rest once, and answers false for an id that
--   is unknown or already finished. Both security definer, executable by
--   service_role ONLY -- service_role has no table grant in vessl, as with
--   tracking_refs_due (138) and apply_tracking_group (140).
--
-- GUARDS, before any change.
--   cron_runs, cron_run_start and cron_run_finish do not exist
--   vessl.is_staff() exists
--
-- PROBES, each undone.
--   p1 As postgres, a refresh run starts and finishes -- the counts land, a
--      second finish answers false and changes nothing.
--   p2 As postgres, a failed digest -- ok false, 502, the error, html dropped.
--   p3 An unknown route is refused (23514).
--   p4 Starting a run deletes a row started 91 days ago and keeps itself.
--   p5 As Jenn signed in, a run started by postgres is visible.
--   p6 As Jenn, inserting a row is refused (42501).
--   p7 As Jenn, calling cron_run_start is refused (42501).
--   p8 As Jenn, updating a row is refused (42501).
--   p9 As a signed-in outsider (not staff), the run is not visible.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre144 on commit drop as
  select
    (select count(*) from pg_class
      where relnamespace = 'vessl'::regnamespace and relname = 'cron_runs')                         as n_table,
    (select count(*) from pg_proc
      where pronamespace = 'vessl'::regnamespace and proname in ('cron_run_start', 'cron_run_finish')) as n_fn,
    (select count(*) from pg_proc where oid = to_regprocedure('vessl.is_staff()'))                  as n_staff_fn,
    (select count(*) from vessl.staff_profiles)                                                     as n_staff;

do $guard$
begin
  if (select n_table from _pre144) <> 0 or (select n_fn from _pre144) <> 0 then
    raise exception 'cron_runs or its functions already exist, nothing changed';
  end if;
  if (select n_staff_fn from _pre144) <> 1 then
    raise exception 'vessl.is_staff() is missing, nothing changed';
  end if;
end
$guard$;

create table vessl.cron_runs (
  id          uuid primary key default gen_random_uuid(),
  route       text not null
              constraint cron_runs_route check (route in ('/api/tracking/refresh', '/api/rfq/digest', '/api/testing/digest')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  http_status integer,
  due         integer,
  checked     integer,
  moved       integer,
  failed      jsonb,
  sent        boolean,
  error       text,
  detail      jsonb,
  deployment  text,
  user_agent  text
);

create index cron_runs_route_started_idx on vessl.cron_runs (route, started_at desc);

comment on table vessl.cron_runs is 'Script 144. One row per authorised run of a scheduled route (tracking refresh, RFQ digest, testing digest). Written only through cron_run_start and cron_run_finish by the service role; staff read. A row with no finished_at timed out or crashed. Rows over 90 days are deleted by the next start.';

alter table vessl.cron_runs enable row level security;

create policy cron_runs_staff_select on vessl.cron_runs
  for select to authenticated using (vessl.is_staff());

revoke all on table vessl.cron_runs from public, anon, authenticated;
grant select on table vessl.cron_runs to authenticated;

create function vessl.cron_run_start(p_route text, p_deployment text default null, p_user_agent text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = vessl, pg_temp
as $fn$
declare
  v_id uuid;
begin
  delete from vessl.cron_runs where started_at < now() - interval '90 days';
  insert into vessl.cron_runs (route, deployment, user_agent)
    values (p_route, left(p_deployment, 64), left(p_user_agent, 300))
    returning id into v_id;
  return v_id;
end
$fn$;

create function vessl.cron_run_finish(p_id uuid, p_ok boolean, p_http_status integer, p_detail jsonb default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = vessl, pg_temp
as $fn$
declare
  d jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  update vessl.cron_runs
     set finished_at = now(),
         ok          = p_ok,
         http_status = p_http_status,
         due         = case when jsonb_typeof(d -> 'due') = 'number' then (d ->> 'due')::numeric::integer end,
         checked     = case when jsonb_typeof(d -> 'checked') = 'number' then (d ->> 'checked')::numeric::integer end,
         moved       = case when jsonb_typeof(d -> 'moved') = 'number' then (d ->> 'moved')::numeric::integer end,
         failed      = case when jsonb_typeof(d -> 'failed') = 'array' then d -> 'failed' end,
         sent        = case when jsonb_typeof(d -> 'sent') = 'boolean' then (d ->> 'sent')::boolean end,
         error       = left(d ->> 'error', 2000),
         detail      = d - 'html'
   where id = p_id
     and finished_at is null;
  return found;
end
$fn$;

comment on function vessl.cron_run_start(text, text, text) is 'Script 144. Starts a cron_runs row for one of the three scheduled routes and returns its id; first deletes rows started over 90 days ago. Service role only.';
comment on function vessl.cron_run_finish(uuid, boolean, integer, jsonb) is 'Script 144. Finishes a cron_runs row once -- ok, HTTP status, and from the route result due, checked, moved, failed, sent, error and the result itself without html. False for an unknown or finished id. Service role only.';

revoke all on function vessl.cron_run_start(text, text, text) from public, anon, authenticated;
revoke all on function vessl.cron_run_finish(uuid, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function vessl.cron_run_start(text, text, text) to service_role;
grant execute on function vessl.cron_run_finish(uuid, boolean, integer, jsonb) to service_role;

create temp table _probe144 (step int, result text) on commit drop;

do $probe$
declare
  n    integer;
  st   text;
  rid  uuid;
  old  uuid;
  msg  text;
  f1   boolean;
  f2   boolean;
begin
  -- p1, as postgres -- a refresh run, finished twice.
  begin
    rid := vessl.cron_run_start('/api/tracking/refresh', 'probe144', 'vercel-cron/1.0');
    f1 := vessl.cron_run_finish(rid, true, 200,
            jsonb_build_object('ok', true, 'due', 1, 'checked', 1, 'shipments', 2, 'moved', 0, 'failed', '[]'::jsonb));
    f2 := vessl.cron_run_finish(rid, false, 500, jsonb_build_object('error', 'second'));
    select f1::text || '/' || f2::text || ' ' || (r.finished_at is not null)::text || '/' || r.ok::text || '/'
           || r.http_status::text || '/' || r.due::text || '/' || r.checked::text || '/' || r.moved::text || '/'
           || r.failed::text || '/' || coalesce(r.error, 'no error') || '/' || r.user_agent
      into msg from vessl.cron_runs r where r.id = rid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- p2, as postgres -- a digest that failed to send.
  begin
    rid := vessl.cron_run_start('/api/rfq/digest', 'probe144', null);
    perform vessl.cron_run_finish(rid, false, 502,
            jsonb_build_object('ok', false, 'error', 'Send failed', 'html', '<p>x</p>'));
    select r.ok::text || '/' || r.http_status::text || '/' || r.error || '/' || coalesce(r.sent::text, 'null')
           || '/html ' || (r.detail ? 'html')::text
      into msg from vessl.cron_runs r where r.id = rid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- p3, an unknown route.
  begin
    rid := vessl.cron_run_start('/api/zz-probe', 'probe144', null);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (3, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p4, the prune.
  begin
    insert into vessl.cron_runs (route, started_at, deployment)
      values ('/api/testing/digest', now() - interval '91 days', 'probe144') returning id into old;
    rid := vessl.cron_run_start('/api/testing/digest', 'probe144', null);
    select 'old ' || (count(*) filter (where id = old))::text || ' new ' || (count(*) filter (where id = rid))::text
      into msg from vessl.cron_runs;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (4, case when st = 'P0001' then msg else st end);
  end;

  -- p5, Jenn sees a run postgres started.
  begin
    rid := vessl.cron_run_start('/api/tracking/refresh', 'probe144', null);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from vessl.cron_runs where id = rid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (5, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p6, Jenn inserts.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.cron_runs (route) values ('/api/tracking/refresh');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (6, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p7, Jenn calls cron_run_start.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    rid := vessl.cron_run_start('/api/tracking/refresh', 'probe144', null);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (7, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p8, Jenn updates a run postgres started.
  begin
    rid := vessl.cron_run_start('/api/tracking/refresh', 'probe144', null);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.cron_runs set ok = true where id = rid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (8, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p9, an outsider signed in, not staff.
  begin
    rid := vessl.cron_run_start('/api/tracking/refresh', 'probe144', null);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001440', 'email', 'zz144-outsider@vessl.io', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from vessl.cron_runs where id = rid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe144 values (9, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, cron_runs absent, staff profiles = ' || (select n_staff::text from _pre144) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 table -- 15 columns, RLS on, one policy (select, staff)',
         (select count(*)::text from information_schema.columns where table_schema = 'vessl' and table_name = 'cron_runs')
           || '/' || (select relrowsecurity::text from pg_class where oid = 'vessl.cron_runs'::regclass)
           || '/' || (select count(*)::text || ' ' || string_agg(polcmd::text || ' ' || pg_get_expr(polqual, polrelid), ', ')
                        from pg_policy where polrelid = 'vessl.cron_runs'::regclass),
         '15/true/1 r vessl.is_staff()'::text
  union all
  select 'b2 table grants -- authenticated select only, anon nothing',
         has_table_privilege('authenticated', 'vessl.cron_runs', 'select')::text
           || '/' || has_table_privilege('authenticated', 'vessl.cron_runs', 'insert')::text
           || '/' || has_table_privilege('authenticated', 'vessl.cron_runs', 'update')::text
           || '/' || has_table_privilege('authenticated', 'vessl.cron_runs', 'delete')::text
           || '/' || has_table_privilege('anon', 'vessl.cron_runs', 'select')::text,
         'true/false/false/false/false'::text
  union all
  select 'b3 functions -- security definer; execute for anon, authenticated, service_role',
         (select string_agg(p.proname || ' ' || p.prosecdef::text
                   || '/' || has_function_privilege('anon', p.oid, 'execute')::text
                   || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
                   || '/' || has_function_privilege('service_role', p.oid, 'execute')::text, ', ' order by p.proname)
            from pg_proc p where p.pronamespace = 'vessl'::regnamespace and p.proname in ('cron_run_start', 'cron_run_finish')),
         'cron_run_finish true/false/false/true, cron_run_start true/false/false/true'::text
  union all
  select 'b4 probes -- refresh run, failed digest, bad route, prune, Jenn sees, Jenn refused x3, outsider sees none',
         (select string_agg(result, ' || ' order by step) from _probe144),
         ('true/false true/true/200/1/1/0/[]/no error/vercel-cron/1.0 || false/502/Send failed/null/html false'
          || ' || 23514 || old 0 new 1 || sees 1 || 42501 || 42501 || 42501 || sees 0')::text
  union all
  select 'b5 no probe row left',
         (select count(*)::text from vessl.cron_runs), '0'::text
  union all
  select 'z0 verification ran, cron_runs rows = ' || (select count(*)::text from vessl.cron_runs),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
