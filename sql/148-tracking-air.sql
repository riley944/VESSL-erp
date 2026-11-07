-- 148 -- ShipsGo air tracking, the database side.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 148r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Run this BEFORE deploying the round 7 stage 2 code -- it
-- writes tracking_provider shipsgo_air, which the checks refuse until now.
--
-- WHAT IT DOES.
--   1. shipments_tracking_provider_check -- null, shipsgo or shipsgo_air (was
--      null or shipsgo). ShipsGo numbers its air and ocean shipments apart, so
--      an air ref gets its own provider and can never meet an ocean ref of the
--      same number.
--   2. shipment_tracking_events_provider_check -- shipsgo or shipsgo_air.
--   3. vessl.apply_tracking_group -- the 142 body with ONE line changed -- the
--      ETD is the first departure event DEPA (ocean) or DEP (air). Nothing else
--      in the body changes -- the forward-only ladder, never delivered, the 142
--      active-only rule, sibling attach and events are as they were. Its comment
--      is replaced; its rights (service_role only) are set again as 142 set them.
-- No row of any table changes.
--
-- GUARDS, before any change.
--   apply_tracking_group is the 142 body (md5 c27d2144.../9608)
--   both checks read as measured on 3 Nov
--   no ZZ-148-PROBE shipment
--
-- PROBES, each undone. Throwaway ZZ-148-PROBE shipments for client ZZTESTER.
--   pa an air row (provider shipsgo_air, no container) and an air payload with an
--      actual DEP -- in_transit, ETD from the DEP, one event stored as shipsgo_air
--   pb an ocean row and an ocean payload with an actual DEPA -- as before 148
--   pc a provider outside the list is refused on shipments and on events (23514)
--   pd a delivered air row on its ref is left alone -- rows 0 closed 1 (142)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre148 on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)'))                         as h_fn,
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipments_tracking_provider_check')     as def_ship,
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipment_tracking_events_provider_check') as def_ev,
    (select count(*) from vessl.shipments where shipment_number like 'ZZ-148-PROBE%')                       as n_probe,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)      as h_ships,
    (select md5(coalesce(string_agg(to_jsonb(e)::text, '/' order by e.id), '')) from vessl.shipment_tracking_events e) as h_events,
    (select count(*) from vessl.order_history)                                                              as n_hist,
    (select count(*) from portal.notifications)                                                             as n_notif;

do $guard$
begin
  if (select h_fn from _pre148) is distinct from 'c27d2144e61c9d89956347a2d1258fc0/9608' then
    raise exception 'apply_tracking_group is not the 142 body, nothing changed';
  end if;
  if (select def_ship from _pre148) is distinct from 'CHECK (((tracking_provider IS NULL) OR (tracking_provider = ''shipsgo''::text)))'
     or (select def_ev from _pre148) is distinct from 'CHECK ((provider = ''shipsgo''::text))' then
    raise exception 'the provider checks are not as measured, nothing changed';
  end if;
  if (select n_probe from _pre148) <> 0 then
    raise exception 'a ZZ-148-PROBE shipment exists, nothing changed';
  end if;
end
$guard$;

-- 1 and 2, the provider checks.
alter table vessl.shipments drop constraint shipments_tracking_provider_check;
alter table vessl.shipments add constraint shipments_tracking_provider_check
  check (tracking_provider is null or tracking_provider in ('shipsgo', 'shipsgo_air'));
alter table vessl.shipment_tracking_events drop constraint shipment_tracking_events_provider_check;
alter table vessl.shipment_tracking_events add constraint shipment_tracking_events_provider_check
  check (provider in ('shipsgo', 'shipsgo_air'));

-- 3, the function -- the 142 body, ETD from DEPA or DEP.
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
                       where e->>'event_code' in ('DEPA', 'DEP')) d) end;
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

comment on function vessl.apply_tracking_group(text, text, jsonb) is 'Script 148. The only writer of tracking data. Service role only. Attaches the live shipments on one B/L or booking to one tracking ref (ocean), or applies to the rows already carrying the ref (air), then writes each active one from its own container or the whole shipment, ETD (first DEPA or DEP) and ETA included; delivered and cancelled rows are never written (142). Silences client notifications for its own cascade, moves status forward only (in_transit to out_for_delivery, never delivered), upserts events.';

revoke all on function vessl.apply_tracking_group(text, text, jsonb) from public, anon, authenticated;
grant execute on function vessl.apply_tracking_group(text, text, jsonb) to service_role;

-- The probe fixtures. pg_temp, gone at the end of the session.
create function pg_temp.zz148_ship(p_tag text, p_mode text, p_bl text, p_box text, p_prov text, p_ref text)
returns uuid
language plpgsql as $fx$
declare
  sh uuid;
begin
  insert into vessl.shipments (shipment_number, status, client_company_id, transport_mode, bill_of_lading, container_no,
                               tracking_provider, tracking_ref)
    values ('ZZ-148-PROBE-' || p_tag, 'created', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, p_mode, p_bl, p_box,
            p_prov, p_ref)
    returning id into sh;
  return sh;
end
$fx$;

-- An air payload as lib/shipsgo.js mapShipsgoAirToUpdate builds it -- no
-- containers, one actual event of p_code at airport ZZA.
create function pg_temp.zz148_air(p_t timestamptz, p_code text, p_target text)
returns jsonb
language sql as $fx$
  select jsonb_build_object('provider', 'shipsgo_air', 'tracking_status', 'EN_ROUTE', 'vessel', 'ZZ AIRLINE', 'voyage', 'ZZ148',
           'eta', p_t + interval '2 days', 'target_status', p_target, 'containers', '[]'::jsonb,
           'events', jsonb_build_array(jsonb_build_object('container_number', '', 'event_code', p_code,
                       'event_status', 'ACT', 'location_code', 'ZZA', 'event_time', p_t)))
$fx$;

-- An ocean payload for one container with one actual event of p_code.
create function pg_temp.zz148_ocean(p_box text, p_t timestamptz, p_code text, p_target text)
returns jsonb
language sql as $fx$
  with c as (
    select jsonb_build_object('number', p_box, 'tracking_status', 'SAILING', 'vessel', 'ZZ VESSEL', 'voyage', 'ZZ148',
             'eta', p_t + interval '20 days', 'target_status', p_target,
             'events', jsonb_build_array(jsonb_build_object('container_number', p_box, 'event_code', p_code,
                         'event_status', 'ACT', 'location_code', 'ZZLOC', 'event_time', p_t))) as c)
  select jsonb_build_object('provider', 'shipsgo', 'tracking_status', 'SAILING', 'vessel', 'ZZ VESSEL', 'voyage', 'ZZ148',
           'eta', p_t + interval '20 days', 'target_status', p_target,
           'containers', jsonb_build_array(c.c), 'events', c.c->'events')
    from c
$fx$;

create temp table _probe148 (step int, result text) on commit drop;

do $probe$
declare
  s1  uuid;
  r   jsonb;
  st  text;
  msg text;
begin
  -- pa, air.
  begin
    s1 := pg_temp.zz148_ship('PA', 'air', '00000000148', null, 'shipsgo_air', 'ZZ148PA');
    r := vessl.apply_tracking_group('ZZ148PA', null, pg_temp.zz148_air(make_timestamptz(2026, 11, 1, 10, 0, 0, 'UTC'), 'DEP', 'in_transit'));
    select s.status::text || ' etd ' || coalesce(to_char(s.estimated_departure at time zone 'UTC', 'YYYY-MM-DD HH24'), 'none')
        || ' vessel ' || coalesce(s.tracking_vessel, 'none')
        || ' events ' || (select count(*)::text || ' ' || coalesce(string_agg(e.provider || ' ' || e.event_code, ', '), '')
                            from vessl.shipment_tracking_events e where e.shipment_id = s1)
      into msg from vessl.shipments s where s.id = s1;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe148 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- pb, ocean, as before.
  begin
    s1 := pg_temp.zz148_ship('PB', 'ocean', 'ZZ148BB', 'ZZZU1480011', null, null);
    r := vessl.apply_tracking_group('ZZ148PB', 'ZZ148BB', pg_temp.zz148_ocean('ZZZU1480011', make_timestamptz(2026, 11, 1, 10, 0, 0, 'UTC'), 'DEPA', 'in_transit'));
    select s.status::text || ' etd ' || coalesce(to_char(s.estimated_departure at time zone 'UTC', 'YYYY-MM-DD HH24'), 'none')
        || ' provider ' || coalesce(s.tracking_provider, 'none')
      into msg from vessl.shipments s where s.id = s1;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe148 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- pc, a provider outside the list -- on shipments, then on events.
  begin
    s1 := pg_temp.zz148_ship('PC', 'air', '00000000149', null, 'zz_other', 'ZZ148PC');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    msg := case when st = 'P0001' then 'allowed' else st end;
  end;
  begin
    s1 := pg_temp.zz148_ship('PC', 'air', '00000000149', null, null, null);
    insert into vessl.shipment_tracking_events (shipment_id, provider, container_number, event_code, event_status, location_code)
      values (s1, 'zz_other', '', 'DEP', 'ACT', 'ZZA');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe148 values (3, msg || ' ' || case when st = 'P0001' then 'allowed' else st end);
  end;

  -- pd, a delivered air row on its ref.
  begin
    s1 := pg_temp.zz148_ship('PD', 'air', '00000000150', null, 'shipsgo_air', 'ZZ148PD');
    update vessl.shipments set status = 'delivered' where id = s1;
    r := vessl.apply_tracking_group('ZZ148PD', null, pg_temp.zz148_air(make_timestamptz(2026, 11, 1, 10, 0, 0, 'UTC'), 'DEP', 'in_transit'));
    msg := 'rows ' || coalesce(jsonb_array_length(r->'rows')::text, 'none') || ' closed ' || coalesce(r->>'closed', 'none')
        || ' ' || (select s.status::text from vessl.shipments s where s.id = s1);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe148 values (4, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, apply_tracking_group = ' || (select h_fn from _pre148) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 provider checks widened',
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipments_tracking_provider_check')
         || ' / ' || (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipment_tracking_events_provider_check'),
         'CHECK (((tracking_provider IS NULL) OR (tracking_provider = ANY (ARRAY[''shipsgo''::text, ''shipsgo_air''::text])))) / CHECK ((provider = ANY (ARRAY[''shipsgo''::text, ''shipsgo_air''::text])))'::text
  union all
  select 'b2 the body -- as written here, and the 142 body but for the ETD line',
         (select md5(prosrc) || '/' || length(prosrc) || ' ' || md5(replace(prosrc, $q$in ('DEPA', 'DEP')) d) end;$q$, $q$= 'DEPA') d) end;$q$))
            from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure),
         'f30d5121a39960cd56f6e5573ca489ae/9618 c27d2144e61c9d89956347a2d1258fc0'::text
  union all
  select 'b3 security definer, execute for anon, authenticated, service_role; comment',
         (select p.prosecdef::text || '/' || has_function_privilege('anon', p.oid, 'execute')::text
                 || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
                 || '/' || has_function_privilege('service_role', p.oid, 'execute')::text
                 || '/' || left(obj_description(p.oid, 'pg_proc'), 11)
            from pg_proc p where p.oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure),
         'true/false/false/true/Script 148.'::text
  union all
  select 'b4 probes -- air, ocean as before, other provider refused, delivered air left alone',
         (select string_agg(result, ' || ' order by step) from _probe148),
         'in_transit etd 2026-11-01 10 vessel ZZ AIRLINE events 1 shipsgo_air DEP || in_transit etd 2026-11-01 10 provider shipsgo || 23514 23514 || rows 0 closed 1 delivered'::text
  union all
  select 'b5 no row changed, no history, no notification',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_ships from _pre148) then 'same' else 'changed' end from vessl.shipments s)
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(e)::text, '/' order by e.id), '')) = (select h_events from _pre148) then 'same' else 'changed' end from vessl.shipment_tracking_events e)
         || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre148))::text
         || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre148))::text,
         'same/same/0/0'::text
  union all
  select 'z0 verification ran, apply_tracking_group = '
         || (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
