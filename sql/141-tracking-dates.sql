-- 141 -- Tracking owns the dates.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 141r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Replaces one function body; no column, index, grant or
-- policy changes.
--
-- WHAT IT DOES. vessl.apply_tracking_group (140) also writes, on every row it
-- touches, estimated_departure -- the first departure the row reports, the
-- earliest actual DEPA event, else the earliest estimated one -- and
-- estimated_arrival -- the tracking ETA (the container discharge ETA, else the
-- route discharge date). Only when tracking has the date; a missing one leaves
-- the column as it is. A row whose container ShipsGo does not list changes
-- neither. actual_arrival is never written. Everything else in the body is 140,
-- byte for byte, and the signature, security definer and service_role-only
-- execute are unchanged.
--
-- NO BACKFILL. A tracked row takes its dates the next time it is applied -- a
-- Track, a webhook, or the daily refresh.
--
-- SILENT, AND WHY. Nothing in the database reacts to these two columns but the
-- order history trigger. On 30 Oct, read-only -- shipments carries two triggers,
-- trg_order_history (records status, estimated_departure and estimated_arrival
-- changes, labelled with vessl.change_note -- here tracking shipsgo) and
-- trg_sync_shipment_status (AFTER UPDATE OF status only); the only functions in
-- vessl and portal that insert portal.notifications are notify_portal_on_so_status
-- (sales order status), raise_message_notification and raise_note_notification.
-- No email path reads a date change either. So a date write raises nothing, with
-- or without vessl.suppress_client_notify, which the function sets anyway. p5
-- proves it both ways.
--
-- GUARDS, before any change.
--   the apply_tracking_group body is 140 as measured (md5 and length)
--   ZZTESTER and ZZTESTFACTORY as measured, no ZZ-140-PROBE row
--
-- PROBES, each undone. Throwaway ZZ-140-PROBE shipments for ZZTESTER, every
-- one starting with staff dates ETD 2026-09-01 and ETA 2026-12-01.
--   p1 Estimated DEPA 28 Sep, actual DEPA 29 Sep, ETA 24 Oct -- ETD 29 Sep (the
--      actual), ETA 24 Oct.
--   p2 Only an estimated DEPA 30 Sep, no ETA -- ETD 30 Sep, ETA kept 1 Dec.
--   p3 No DEPA, no ETA, an ATA 23 Oct -- both dates kept, actual_arrival empty.
--   p4 Container not on the B/L -- both dates kept, the error set.
--   p5 Silent -- on a row linked to a throwaway SO, the function moves both
--      dates with no notification and writes one history row for the ETA,
--      labelled tracking shipsgo; the same ETA change made directly raises none.
--   p6 The webhook path (ref only) moves the ETA again when tracking moves it.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

set local vessl.change_note = 'script 141 probes, throwaway ZZ-140-PROBE shipments, undone';

create temp table _pre141 on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc)::text from pg_proc
      where oid = to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)'))                as group_src,
    (select count(*) from vessl.companies
      where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid and type = 'client' and length(name) = 8)
      + (select count(*) from vessl.companies
      where id = '5fa19444-d240-48bb-b170-98119697919a'::uuid and type = 'factory' and length(name) = 13) as n_zz,
    (select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')
      + (select count(*) from vessl.purchase_orders where order_number = 'ZZ-140-PROBE')
      + (select count(*) from vessl.sales_orders where so_number = 'ZZ-140-PROBE')                as n_probe_rows,
    (select count(*) from vessl.shipments)                                                         as n_ship,
    (select count(*) from portal.notifications)                                                    as n_notif,
    (select count(*) from vessl.shipment_tracking_events)                                          as n_events,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)        as h_ship,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.sales_orders o)     as h_so,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.purchase_orders o)  as h_po,
    (select count(*) from vessl.order_history)                                                     as n_hist;

do $guard$
begin
  if (select group_src from _pre141) is distinct from 'c400d8e95e218134d1add0495834a6f1/7771' then
    raise exception 'apply_tracking_group is not the 140 body as measured, nothing changed';
  end if;
  if (select n_zz from _pre141) <> 2 or (select n_probe_rows from _pre141) <> 0 then
    raise exception 'ZZTESTER or ZZTESTFACTORY is not as measured, or a ZZ-140-PROBE row exists, nothing changed';
  end if;
end
$guard$;

-- The 140 body with the two dates added.
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

  -- WRITE. Each attached row from its own container.
  for r in select s.id, s.status::text as cur,
                  upper(replace(btrim(coalesce(s.container_no, '')), ' ', '')) as cn
             from vessl.shipments s
            where s.tracking_provider = prov and s.tracking_ref = v_ref
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

  if n_rows = 0 then
    raise exception 'apply_tracking_group found no shipment' using errcode = 'P0002';
  end if;

  perform set_config('vessl.suppress_client_notify', '', true);

  return jsonb_build_object('ref', v_ref, 'rows', out_rows, 'moved', n_moved, 'skipped', skipped);
end
$fn$;

comment on function vessl.apply_tracking_group(text, text, jsonb) is 'Script 141. The only writer of tracking data. Service role only. Attaches the live shipments on one B/L or booking to one tracking ref, then writes each from its own container, ETD and ETA included (141). Silences client notifications for its own cascade, moves status forward only (in_transit to out_for_delivery, never delivered), upserts events.';

revoke all on function vessl.apply_tracking_group(text, text, jsonb) from public, anon, authenticated;
grant execute on function vessl.apply_tracking_group(text, text, jsonb) to service_role;

-- The probe fixtures. pg_temp, dropped below. Every probe shipment starts with
-- staff dates ETD 2026-09-01 and ETA 2026-12-01.
create function pg_temp.zz141_ship(p_tag text, p_box text)
returns uuid
language plpgsql as $fx$
declare
  sh uuid;
begin
  insert into vessl.shipments (shipment_number, status, client_company_id, bill_of_lading, container_no,
                               estimated_departure, estimated_arrival)
    values ('ZZ-140-PROBE-' || p_tag, 'created', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'ZZ141B' || p_tag, p_box,
            make_timestamptz(2026, 9, 1, 12, 0, 0, 'UTC'), make_timestamptz(2026, 12, 1, 12, 0, 0, 'UTC'))
    returning id into sh;
  return sh;
end
$fx$;

-- A throwaway PO and SO for ZZTESTER, linked to the shipment. Returns the SO.
create function pg_temp.zz141_chain(p_ship uuid)
returns uuid
language plpgsql as $fx$
declare
  po uuid;
  so uuid;
begin
  insert into vessl.purchase_orders (order_number, factory_company_id, client_company_id, status)
    values ('ZZ-140-PROBE', '5fa19444-d240-48bb-b170-98119697919a'::uuid, 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'in_production')
    returning id into po;
  insert into vessl.sales_orders (so_number, client_company_id, status)
    values ('ZZ-140-PROBE', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'in_production')
    returning id into so;
  insert into vessl.sales_order_pos (sales_order_id, purchase_order_id) values (so, po);
  insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (p_ship, po);
  return so;
end
$fx$;

-- One movement, as the mapping sends it.
create function pg_temp.zz141_ev(p_box text, p_code text, p_status text, p_time timestamptz)
returns jsonb
language sql as $fx$
  select jsonb_build_object('container_number', p_box, 'event_code', p_code, 'event_status', p_status,
           'location_code', 'ZZ' || p_code || p_status, 'event_time', p_time)
$fx$;

-- A one-container payload -- its events, its ETA and ATA, no status target.
create function pg_temp.zz141_payload(p_box text, p_events jsonb, p_eta timestamptz, p_ata timestamptz)
returns jsonb
language sql as $fx$
  select jsonb_build_object('provider', 'shipsgo', 'tracking_status', 'ZZSHIP', 'eta', p_eta, 'ata', p_ata,
           'events', p_events,
           'containers', jsonb_build_array(jsonb_build_object('number', p_box, 'tracking_status', 'ZZSTATUS',
                           'eta', p_eta, 'ata', p_ata, 'target_status', null, 'events', p_events)))
$fx$;

-- The two staff dates of a shipment, as text.
create function pg_temp.zz141_dates(p_ship uuid)
returns text
language sql as $fx$
  select 'etd ' || coalesce(to_char(s.estimated_departure at time zone 'UTC', 'YYYY-MM-DD'), 'empty')
      || ' | eta ' || coalesce(to_char(s.estimated_arrival at time zone 'UTC', 'YYYY-MM-DD'), 'empty')
    from vessl.shipments s where s.id = p_ship
$fx$;

create temp table _probe141 (step int, result text) on commit drop;

do $probe$
declare
  s1  uuid;
  so  uuid;
  n   integer;
  n0  integer;
  h   integer;
  r   jsonb;
  st  text;
  msg text;
begin
  -- p1, estimated then actual departure, and an ETA.
  begin
    s1 := pg_temp.zz141_ship('41A', 'ZZZU1410011');
    r := vessl.apply_tracking_group('ZZ141P1', 'ZZ141B41A', pg_temp.zz141_payload('ZZZU1410011', jsonb_build_array(
           pg_temp.zz141_ev('ZZZU1410011', 'DEPA', 'EST', make_timestamptz(2026, 9, 28, 4, 0, 0, 'UTC')),
           pg_temp.zz141_ev('ZZZU1410011', 'DEPA', 'ACT', make_timestamptz(2026, 9, 29, 4, 0, 0, 'UTC'))),
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), null));
    msg := coalesce(pg_temp.zz141_dates(s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- p2, only an estimated departure, no ETA.
  begin
    s1 := pg_temp.zz141_ship('41B', 'ZZZU1410021');
    r := vessl.apply_tracking_group('ZZ141P2', 'ZZ141B41B', pg_temp.zz141_payload('ZZZU1410021', jsonb_build_array(
           pg_temp.zz141_ev('ZZZU1410021', 'DEPA', 'EST', make_timestamptz(2026, 9, 30, 4, 0, 0, 'UTC'))),
           null, null));
    msg := coalesce(pg_temp.zz141_dates(s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- p3, no departure and no ETA, but an arrival.
  begin
    s1 := pg_temp.zz141_ship('41C', 'ZZZU1410031');
    r := vessl.apply_tracking_group('ZZ141P3', 'ZZ141B41C', pg_temp.zz141_payload('ZZZU1410031', jsonb_build_array(
           pg_temp.zz141_ev('ZZZU1410031', 'ARRV', 'ACT', make_timestamptz(2026, 10, 23, 19, 0, 0, 'UTC'))),
           null, make_timestamptz(2026, 10, 23, 19, 0, 0, 'UTC')));
    msg := coalesce(pg_temp.zz141_dates(s1), 'none')
        || ' | actual ' || coalesce((select coalesce(s.actual_arrival::text, 'empty') from vessl.shipments s where s.id = s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (3, case when st = 'P0001' then msg else st end);
  end;

  -- p4, a container ShipsGo does not list.
  begin
    s1 := pg_temp.zz141_ship('41D', 'ZZZU1419999');
    r := vessl.apply_tracking_group('ZZ141P4', 'ZZ141B41D', pg_temp.zz141_payload('ZZZU1410041', jsonb_build_array(
           pg_temp.zz141_ev('ZZZU1410041', 'DEPA', 'ACT', make_timestamptz(2026, 9, 29, 4, 0, 0, 'UTC'))),
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), null));
    msg := coalesce(pg_temp.zz141_dates(s1), 'none')
        || ' | ' || coalesce((select case when s.tracking_error is null then 'no error' else 'error set' end
                                from vessl.shipments s where s.id = s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (4, case when st = 'P0001' then msg else st end);
  end;

  -- p5, silent -- through the function, then the same kind of change made directly.
  begin
    s1 := pg_temp.zz141_ship('41E', 'ZZZU1410051');
    so := pg_temp.zz141_chain(s1);
    select count(*) into n0 from portal.notifications;
    r := vessl.apply_tracking_group('ZZ141P5', 'ZZ141B41E', pg_temp.zz141_payload('ZZZU1410051', jsonb_build_array(
           pg_temp.zz141_ev('ZZZU1410051', 'DEPA', 'ACT', make_timestamptz(2026, 9, 29, 4, 0, 0, 'UTC'))),
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), null));
    select count(*) into n from portal.notifications;
    select count(*) into h from vessl.order_history
     where row_id = s1 and action = 'update' and field = 'estimated_arrival' and note = 'tracking shipsgo';
    msg := 'notif +' || coalesce((n - n0)::text, 'none') || ' | history ' || coalesce(h::text, 'none');
    perform set_config('vessl.suppress_client_notify', '', true);
    update vessl.shipments set estimated_arrival = make_timestamptz(2026, 10, 30, 12, 0, 0, 'UTC') where id = s1;
    select count(*) into n0 from portal.notifications;
    msg := msg || ' | direct +' || coalesce((n0 - n)::text, 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (5, case when st = 'P0001' then msg else st end);
  end;

  -- p6, the webhook path moves the ETA when tracking moves it.
  begin
    s1 := pg_temp.zz141_ship('41F', 'ZZZU1410061');
    r := vessl.apply_tracking_group('ZZ141P6', 'ZZ141B41F', pg_temp.zz141_payload('ZZZU1410061', '[]'::jsonb,
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), null));
    msg := coalesce((select to_char(s.estimated_arrival at time zone 'UTC', 'YYYY-MM-DD') from vessl.shipments s where s.id = s1), 'none');
    r := vessl.apply_tracking_group('ZZ141P6', null, pg_temp.zz141_payload('ZZZU1410061', '[]'::jsonb,
           make_timestamptz(2026, 10, 26, 19, 0, 0, 'UTC'), null));
    msg := 'eta ' || msg || ' then '
        || coalesce((select to_char(s.estimated_arrival at time zone 'UTC', 'YYYY-MM-DD') from vessl.shipments s where s.id = s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe141 values (6, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

drop function pg_temp.zz141_ship(text, text);
drop function pg_temp.zz141_chain(uuid);
drop function pg_temp.zz141_ev(text, text, text, timestamptz);
drop function pg_temp.zz141_payload(text, jsonb, timestamptz, timestamptz);
drop function pg_temp.zz141_dates(uuid);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments/notifications = ' || (select n_ship::text || '/' || n_notif::text from _pre141) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the body writes both dates; security definer; execute for anon, authenticated, service_role',
         (select (prosrc like '%estimated_departure = coalesce(etd%')::text || '/' || (prosrc like '%estimated_arrival = coalesce(eta%')::text
                 || '/' || prosecdef::text
            from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text,
         'true/true/true/false/false/true'::text
  union all
  select 'b2 the comment names 141',
         (select (obj_description(oid, 'pg_proc') like 'Script 141.%')::text
            from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure),
         'true'::text
  union all
  select 'b3 probes -- actual departure first, estimated only, nothing to write, unlisted, silent, by ref',
         (select string_agg(result, ' || ' order by step) from _probe141),
         'etd 2026-09-29 | eta 2026-10-24 || etd 2026-09-30 | eta 2026-12-01 || etd 2026-09-01 | eta 2026-12-01 | actual empty || etd 2026-09-01 | eta 2026-12-01 | error set || notif +0 | history 1 | direct +0 || eta 2026-10-24 then 2026-10-26'::text
  union all
  select 'b4 existing shipments, sales orders and purchase orders unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_ship from _pre141) then 'same' else 'changed' end from vessl.shipments s)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_so from _pre141) then 'same' else 'changed' end from vessl.sales_orders o)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_po from _pre141) then 'same' else 'changed' end from vessl.purchase_orders o),
         'same/same/same'::text
  union all
  select 'b5 probes left nothing -- probe rows, events, notifications, order history',
         ((select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')
           + (select count(*) from vessl.purchase_orders where order_number = 'ZZ-140-PROBE')
           + (select count(*) from vessl.sales_orders where so_number = 'ZZ-140-PROBE'))::text
           || '/' || ((select count(*) from vessl.shipment_tracking_events) - (select n_events from _pre141))::text
           || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre141))::text
           || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre141))::text,
         '0/0/0/0'::text
  union all
  select 'z0 verification ran, shipments/notifications = '
           || (select count(*)::text from vessl.shipments) || '/' || (select count(*)::text from portal.notifications),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
