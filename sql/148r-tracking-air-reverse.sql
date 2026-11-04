-- 148r -- Reverse of 148. Air tracking off in the database.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- Take the round 7 stage 2 code out first, and clear or delete any air
-- tracking first -- the narrowed checks refuse a row or event that is
-- shipsgo_air, so the guard stops while one exists.
--
-- WHAT IT DOES. The two provider checks back to shipsgo only, and
-- apply_tracking_group back to the 142 body exactly (md5 c27d2144.../9608) with
-- the 142 comment. No row changes.
--
-- GUARDS, before any change.
--   148 is committed -- the function is the 148 body
--   no shipment and no tracking event carries shipsgo_air
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre148r on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)'))                         as h_fn,
    (select count(*) from vessl.shipments where tracking_provider = 'shipsgo_air')                          as n_air_rows,
    (select count(*) from vessl.shipment_tracking_events where provider = 'shipsgo_air')                    as n_air_events;

do $guard$
begin
  if (select h_fn from _pre148r) is distinct from 'f30d5121a39960cd56f6e5573ca489ae/9618' then
    raise exception 'apply_tracking_group is not the 148 body, nothing changed';
  end if;
  if (select n_air_rows from _pre148r) <> 0 or (select n_air_events from _pre148r) <> 0 then
    raise exception 'air tracking is in use (shipsgo_air rows or events), nothing changed';
  end if;
end
$guard$;

alter table vessl.shipments drop constraint shipments_tracking_provider_check;
alter table vessl.shipments add constraint shipments_tracking_provider_check
  check (tracking_provider is null or tracking_provider = 'shipsgo');
alter table vessl.shipment_tracking_events drop constraint shipment_tracking_events_provider_check;
alter table vessl.shipment_tracking_events add constraint shipment_tracking_events_provider_check
  check (provider = 'shipsgo');

-- The function, the 142 body exactly.
create or replace function vessl.apply_tracking_group(p_ref text, p_number text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = vessl, pg_temp
as $fn$
declare
  prov    text := nullif(p_data->>'provider', '');
  v_ref     text := nullif(btrim(coalesce(p_ref, '')), '');
  num     text := nullif(upper(replace(btrim(coalesce(p_number, '')), ' ', '')), '');
  conts   jsonb := coalesce(p_data->'containers', '[]'::jsonb);
  -- The order status moves through. delivered, cancelled, delayed and exception
  -- are not on it, so a shipment at any of them is never moved.
  ladder  text[] := array['created', 'at_origin_port', 'in_transit', 'at_transshipment',
                          'at_destination_port', 'customs', 'out_for_delivery'];
  -- What tracking may set. Nothing before departure, never delivered.
  allowed text[] := array['in_transit', 'at_transshipment', 'at_destination_port',
                          'customs', 'out_for_delivery'];
  r        record;
  c        jsonb;
  src      jsonb;
  unlisted boolean;
  tgt      text;
  err      text;
  moved    boolean;
  n_ev     integer;
  etd      timestamptz;
  eta      timestamptz;
  n_rows   integer := 0;
  n_closed integer := 0;
  n_moved  integer := 0;
  out_rows jsonb := '[]'::jsonb;
  skipped  jsonb := '[]'::jsonb;
begin
  -- Both for this transaction only. The flag silences notify_portal_on_so_status
  -- for the cascade the status updates below set off; change_note labels the
  -- order history rows they write.
  perform set_config('vessl.suppress_client_notify', 'on', true);
  perform set_config('vessl.change_note', 'tracking ' || coalesce(prov, 'unknown'), true);

  if prov is null or v_ref is null then
    raise exception 'apply_tracking_group needs a provider and a ref' using errcode = '22023';
  end if;

  -- ATTACH. The live siblings -- the same number, not delivered or cancelled,
  -- not tracked yet. One tracked under another ref is reported, not moved.
  if num is not null then
    select coalesce(jsonb_agg(jsonb_build_object('shipment_id', s.id, 'tracking_ref', s.tracking_ref) order by s.id), '[]'::jsonb)
      into skipped
      from vessl.shipments s
     where coalesce(nullif(upper(replace(btrim(coalesce(s.bill_of_lading, '')), ' ', '')), ''),
                    nullif(upper(replace(btrim(coalesce(s.booking_number, '')), ' ', '')), '')) = num
       and s.status::text not in ('delivered', 'cancelled')
       and s.tracking_ref is not null
       and not (s.tracking_provider = prov and s.tracking_ref = v_ref);

    update vessl.shipments s set tracking_provider = prov, tracking_ref = v_ref
     where s.id in (select s2.id from vessl.shipments s2
                     where coalesce(nullif(upper(replace(btrim(coalesce(s2.bill_of_lading, '')), ' ', '')), ''),
                                    nullif(upper(replace(btrim(coalesce(s2.booking_number, '')), ' ', '')), '')) = num
                       and s2.status::text not in ('delivered', 'cancelled')
                       and s2.tracking_ref is null
                     order by s2.id
                       for update);
  end if;

  -- WRITE. Each attached row from its own container -- active rows only (142).
  -- A delivered or cancelled shipment keeps the last tracking it had -- no
  -- tracking columns, no dates, no events, no history row, on any path.
  for r in select s.id, s.status::text as cur,
                  upper(replace(btrim(coalesce(s.container_no, '')), ' ', '')) as cn
             from vessl.shipments s
            where s.tracking_provider = prov and s.tracking_ref = v_ref
              and s.status::text not in ('delivered', 'cancelled')
            order by s.id
              for update
  loop
    n_rows := n_rows + 1;
    c := null;
    unlisted := false;
    err := nullif(p_data->>'error', '');

    if r.cn <> '' and jsonb_array_length(conts) > 0 then
      select x.value into c from jsonb_array_elements(conts) x
       where upper(replace(btrim(coalesce(x.value->>'number', '')), ' ', '')) = r.cn
       limit 1;
      if c is null then
        unlisted := true;
        err := coalesce(err, 'Container ' || r.cn || ' is not on this B/L at ShipsGo (it lists '
                 || coalesce((select string_agg(x.value->>'number', ', ' order by x.n) from jsonb_array_elements(conts) with ordinality x(value, n)), 'none') || ')');
      end if;
    end if;

    -- The source of this row -- its container, else the whole shipment.
    src := coalesce(c, p_data);

    -- THE DATES (script 141). Tracking owns ETD and ETA on a tracked row. ETD is
    -- the first departure this row reports -- the earliest actual DEPA, else the
    -- earliest estimated one -- and ETA the discharge ETA. A date tracking does
    -- not have leaves the column as it is; a container not on the B/L changes
    -- neither. actual_arrival is never written, here or anywhere in tracking.
    etd := case when unlisted then null else
             (select coalesce(min(d.t) filter (where d.st = 'ACT'), min(d.t))
                from (select nullif(e->>'event_time', '')::timestamptz as t, e->>'event_status' as st
                        from jsonb_array_elements(coalesce(src->'events', '[]'::jsonb)) e
                       where e->>'event_code' = 'DEPA') d) end;
    eta := case when unlisted then null else nullif(src->>'eta', '')::timestamptz end;

    update vessl.shipments set
      tracking_container  = case when c is null then null else c->>'number' end,
      tracking_status     = case when unlisted then null else nullif(src->>'tracking_status', '') end,
      tracking_vessel     = nullif(src->>'vessel', ''),
      tracking_voyage     = nullif(src->>'voyage', ''),
      tracking_eta        = case when unlisted then null else nullif(src->>'eta', '')::timestamptz end,
      tracking_ata        = case when unlisted then null else nullif(src->>'ata', '')::timestamptz end,
      estimated_departure = coalesce(etd, estimated_departure),
      estimated_arrival = coalesce(eta, estimated_arrival),
      tracking_error      = err,
      tracking_checked_at = now()
    where id = r.id;

    -- FORWARD ONLY. A separate statement, so the status trigger fires only when
    -- the status really moves.
    tgt := case when unlisted then null else nullif(src->>'target_status', '') end;
    moved := false;
    if tgt = any(allowed) and r.cur = any(ladder)
       and array_position(ladder, tgt) > array_position(ladder, r.cur) then
      update vessl.shipments set status = tgt::vessl.container_status, updated_at = now() where id = r.id;
      moved := true;
      n_moved := n_moved + 1;
    end if;

    -- One row per container, code and location; when a payload repeats one, the
    -- actual beats the estimate and the latest time wins.
    n_ev := 0;
    if not unlisted then
      insert into vessl.shipment_tracking_events
        (shipment_id, provider, container_number, event_code, event_status, location_code,
         location_name, vessel_name, vessel_imo, voyage, event_time, raw)
      select distinct on (cn, code, loc)
             r.id, prov, cn, code, st, loc, locn, vn, imo, voy, t, rw
        from (select coalesce(e->>'container_number', '') as cn,
                     e->>'event_code'                     as code,
                     e->>'event_status'                   as st,
                     coalesce(e->>'location_code', '')    as loc,
                     e->>'location_name'                  as locn,
                     e->>'vessel_name'                    as vn,
                     e->>'vessel_imo'                     as imo,
                     e->>'voyage'                         as voy,
                     nullif(e->>'event_time', '')::timestamptz as t,
                     e->'raw'                             as rw
                from jsonb_array_elements(coalesce(src->'events', '[]'::jsonb)) e
               where nullif(e->>'event_code', '') is not null) x
       order by cn, code, loc, (st = 'ACT') desc, t desc nulls last
      on conflict (shipment_id, provider, container_number, event_code, location_code) do update set
        event_status  = excluded.event_status,
        event_time    = excluded.event_time,
        location_name = excluded.location_name,
        vessel_name   = excluded.vessel_name,
        vessel_imo    = excluded.vessel_imo,
        voyage        = excluded.voyage,
        raw           = excluded.raw,
        updated_at    = now();
      get diagnostics n_ev = row_count;
    end if;

    out_rows := out_rows || jsonb_build_array(jsonb_build_object(
      'shipment_id', r.id, 'status_before', r.cur,
      'status_after', case when moved then tgt else r.cur end, 'moved', moved, 'events', n_ev,
      'container', case when c is null then null else c->>'number' end, 'error', err));
  end loop;

  -- NO SHIPMENT IS NOT THE SAME AS NO ACTIVE SHIPMENT (142). P0002 only when no
  -- row carries the ref at all -- the webhook answers that with 200, not ours.
  -- When rows carry it but every one is closed, nothing was written and the
  -- result says so -- rows empty, closed the count.
  select count(*) into n_closed from vessl.shipments s
   where s.tracking_provider = prov and s.tracking_ref = v_ref
     and s.status::text in ('delivered', 'cancelled');
  if n_rows = 0 and n_closed = 0 then
    raise exception 'apply_tracking_group found no shipment' using errcode = 'P0002';
  end if;

  perform set_config('vessl.suppress_client_notify', '', true);

  return jsonb_build_object('ref', v_ref, 'rows', out_rows, 'moved', n_moved, 'skipped', skipped, 'closed', n_closed);
end
$fn$;

comment on function vessl.apply_tracking_group(text, text, jsonb) is 'Script 142. The only writer of tracking data. Service role only. Attaches the live shipments on one B/L or booking to one tracking ref, then writes each active one from its own container, ETD and ETA included (141); delivered and cancelled rows are never written (142). Silences client notifications for its own cascade, moves status forward only (in_transit to out_for_delivery, never delivered), upserts events.';

revoke all on function vessl.apply_tracking_group(text, text, jsonb) from public, anon, authenticated;
grant execute on function vessl.apply_tracking_group(text, text, jsonb) to service_role;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, apply_tracking_group = ' || (select h_fn from _pre148r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 checks back to shipsgo only',
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipments_tracking_provider_check')
         || ' / ' || (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipment_tracking_events_provider_check'),
         'CHECK (((tracking_provider IS NULL) OR (tracking_provider = ''shipsgo''::text))) / CHECK ((provider = ''shipsgo''::text))'::text
  union all
  select 'b2 the 142 body exactly, its comment, service_role only',
         (select md5(p.prosrc) || '/' || length(p.prosrc) || '/' || left(obj_description(p.oid, 'pg_proc'), 11)
                 || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
                 || '/' || has_function_privilege('service_role', p.oid, 'execute')::text
            from pg_proc p where p.oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure),
         'c27d2144e61c9d89956347a2d1258fc0/9608/Script 142./false/true'::text
  union all
  select 'z0 verification ran',
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
