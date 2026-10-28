-- 138 -- The list the daily tracking refresh reads.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 138r.
-- Run this BEFORE the code that uses it is deployed -- GET /api/tracking/refresh
-- calls it with the service role key. Nothing live names it.
--
-- WHAT IT DOES. One function, vessl.tracking_refs_due(), security definer,
-- stable, executable by service_role ONLY. It returns every shipment that has a
-- tracking_ref and is not delivered or cancelled -- shipment_id,
-- tracking_provider, tracking_ref, status, tracking_checked_at -- oldest check
-- first. service_role has no table grant in vessl, so this is the one door the
-- cron gets; it writes through vessl.apply_tracking_update (script 137).
--
-- GUARDS, before any change.
--   137 committed -- the tracking columns and apply_tracking_update exist
--   tracking_refs_due does not exist yet
--
-- PROBES, each undone.
--   p1 As Jenn signed in, calling tracking_refs_due is refused (42501).
--   p2 As postgres, a throwaway ZZ-138-PROBE shipment in_transit with a ref is
--      listed, and the same shipment once delivered is not.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre138 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%')  as n_cols,
    (select count(*) from pg_proc where oid = to_regprocedure('vessl.apply_tracking_update(uuid,jsonb)')) as n_apply,
    (select count(*) from pg_proc
      where pronamespace = 'vessl'::regnamespace and proname = 'tracking_refs_due')                as n_fn,
    (select count(*) from vessl.shipments where shipment_number = 'ZZ-138-PROBE')                   as n_probe,
    (select count(*) from vessl.shipments
      where tracking_ref is not null and status::text not in ('delivered', 'cancelled'))           as n_due,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s) as h_ship;

do $guard$
begin
  if (select n_cols from _pre138) <> 9 or (select n_apply from _pre138) <> 1 then
    raise exception '137 is not committed, nothing changed';
  end if;
  if (select n_fn from _pre138) <> 0 or (select n_probe from _pre138) <> 0 then
    raise exception 'tracking_refs_due or a ZZ-138-PROBE shipment already exists, nothing changed';
  end if;
end
$guard$;

create function vessl.tracking_refs_due()
returns table (shipment_id uuid, tracking_provider text, tracking_ref text, status text, tracking_checked_at timestamptz)
language sql
stable
security definer
set search_path = vessl, pg_temp
as $fn$
  select s.id, s.tracking_provider, s.tracking_ref, s.status::text, s.tracking_checked_at
    from vessl.shipments s
   where s.tracking_ref is not null
     and s.status::text not in ('delivered', 'cancelled')
   order by s.tracking_checked_at nulls first, s.id
$fn$;

comment on function vessl.tracking_refs_due() is 'Script 138. Shipments the daily tracking refresh re-reads -- a tracking_ref, not delivered or cancelled, oldest check first. Service role only.';

revoke all on function vessl.tracking_refs_due() from public, anon, authenticated;
grant execute on function vessl.tracking_refs_due() to service_role;

create temp table _probe138 (step int, result text) on commit drop;

do $probe$
declare
  n   integer;
  st  text;
  sh  uuid;
  msg text;
begin
  -- p1, as Jenn.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from vessl.tracking_refs_due();
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe138 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2, as postgres -- listed in transit, gone once delivered.
  begin
    insert into vessl.shipments (shipment_number, status, tracking_provider, tracking_ref)
      values ('ZZ-138-PROBE', 'in_transit', 'shipsgo', 'ZZ138P2') returning id into sh;
    select 'listed ' || count(*)::text into msg from vessl.tracking_refs_due() d where d.shipment_id = sh;
    update vessl.shipments set status = 'delivered' where id = sh;
    select msg || ' | delivered ' || count(*)::text into msg from vessl.tracking_refs_due() d where d.shipment_id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe138 values (2, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments due a refresh = ' || (select n_due::text from _pre138) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 function -- security definer, stable; execute for anon, authenticated, service_role',
         (select prosecdef::text || '/' || provolatile::text from pg_proc where oid = 'vessl.tracking_refs_due()'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.tracking_refs_due()', 'execute')::text,
         'true/s/false/false/true'::text
  union all
  select 'b2 it lists what was due before',
         (select count(*)::text from vessl.tracking_refs_due()), (select n_due::text from _pre138)
  union all
  select 'b3 probes -- staff refused, listed in transit, not once delivered',
         (select string_agg(result, ' || ' order by step) from _probe138),
         '42501 || listed 1 | delivered 0'::text
  union all
  select 'b4 shipments unchanged, no probe row left',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_ship from _pre138) then 'same' else 'changed' end from vessl.shipments s)
           || '/' || (select count(*)::text from vessl.shipments where shipment_number = 'ZZ-138-PROBE'),
         'same/0'::text
  union all
  select 'z0 verification ran, shipments due = ' || (select count(*)::text from vessl.tracking_refs_due()),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
