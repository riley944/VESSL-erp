-- 142 -- Tracking touches active shipments only.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 142r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Replaces one function body; no column, index, grant or
-- policy changes. No code change is needed with it.
--
-- WHY. In the 141 body the write loop takes every row carrying the ref,
--     where s.tracking_provider = prov and s.tracking_ref = v_ref
-- so a shipment that is delivered or cancelled but still carries the ref kept
-- getting tracking columns, ETD and ETA (each date change a history row) and
-- events, from the webhook, from Track or Refresh on its card, and from the
-- daily refresh of a ref that still has a live sibling. Its status never moved
-- (neither status is on the ladder), but nothing else stopped.
--
-- WHAT IT DOES. vessl.apply_tracking_group (the 141 body otherwise byte for byte)
--   1. adds  and s.status::text not in (delivered, cancelled)  to the write loop,
--      so a closed row is skipped on every path. Attaching already skipped them.
--   2. counts the closed rows carrying the ref (n_closed) and raises P0002 only
--      when no row carries the ref at all. A ref whose rows are all closed writes
--      nothing and returns rows empty and closed n, without an error -- so the
--      webhook answers 200 and Refresh on a delivered card does not show an error.
--   3. returns closed with every result.
-- A closed row keeps the last tracking it had, as a frozen record.
--
-- GUARDS, before any change.
--   the apply_tracking_group body is 141 as measured on 2 Nov (md5 and length)
--   ZZTESTER and ZZTESTFACTORY as measured, no ZZ-140-PROBE row
--
-- PROBES, each undone. Throwaway ZZ-140-PROBE shipments for ZZTESTER, attached
-- while live by a first call, then closed directly, then sent a second payload
-- by ref only (the webhook path) whose ETA, vessel, status word, target and event
-- all differ -- so any write to a closed row would change it.
--   pa A delivered row and a live row share the ref. The delivered row is the
--      same row after (every column), with the same events and history; the
--      live row takes the new ETA and moves to in_transit. rows 1, closed 1.
--   pb Both rows delivered. No error; rows 0, closed 2; both rows the same.
--   pc A ref no row carries still raises P0002.
--   pd A cancelled row is skipped exactly as a delivered one.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

set local vessl.change_note = 'script 142 probes, throwaway ZZ-140-PROBE shipments, undone';

create temp table _pre142 on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc)::text from pg_proc
      where oid = to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)'))                as group_src,
    (select count(*) from vessl.companies
      where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid and type = 'client' and length(name) = 8)
      + (select count(*) from vessl.companies
      where id = '5fa19444-d240-48bb-b170-98119697919a'::uuid and type = 'factory' and length(name) = 13) as n_zz,
    (select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')              as n_probe_rows,
    (select count(*) from vessl.shipments)                                                         as n_ship,
    (select count(*) from portal.notifications)                                                    as n_notif,
    (select count(*) from vessl.shipment_tracking_events)                                          as n_events,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)        as h_ship,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.sales_orders o)     as h_so,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.purchase_orders o)  as h_po,
    (select count(*) from vessl.order_history)                                                     as n_hist;

do $guard$
begin
  if (select group_src from _pre142) is distinct from '38d73a0318aaf62bf0cbe74237b9ecc6/8829' then
    raise exception 'apply_tracking_group is not the 141 body as measured, nothing changed';
  end if;
  if (select n_zz from _pre142) <> 2 or (select n_probe_rows from _pre142) <> 0 then
    raise exception 'ZZTESTER or ZZTESTFACTORY is not as measured, or a ZZ-140-PROBE row exists, nothing changed';
  end if;
end
$guard$;

-- The 141 body with closed rows skipped.
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

-- The probe fixtures. pg_temp, dropped below.
create function pg_temp.zz142_ship(p_tag text, p_bl text, p_box text)
returns uuid
language plpgsql as $fx$
declare
  sh uuid;
begin
  insert into vessl.shipments (shipment_number, status, client_company_id, bill_of_lading, container_no)
    values ('ZZ-140-PROBE-' || p_tag, 'created', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, p_bl, p_box)
    returning id into sh;
  return sh;
end
$fx$;

-- A payload for the given containers, each with one actual event of p_code,
-- the same ETA, vessel, status word and target.
create function pg_temp.zz142_payload(p_boxes text[], p_eta timestamptz, p_vessel text, p_word text, p_target text, p_code text)
returns jsonb
language sql as $fx$
  with b as (
    select x.box, jsonb_build_object('number', x.box, 'tracking_status', p_word, 'vessel', p_vessel, 'voyage', 'ZZ142',
             'eta', p_eta, 'target_status', p_target,
             'events', jsonb_build_array(jsonb_build_object('container_number', x.box, 'event_code', p_code,
                         'event_status', 'ACT', 'location_code', 'ZZLOC', 'event_time', p_eta))) as c
      from unnest(p_boxes) x(box))
  select jsonb_build_object('provider', 'shipsgo', 'tracking_status', p_word, 'vessel', p_vessel, 'voyage', 'ZZ142',
           'eta', p_eta, 'target_status', p_target,
           'containers', (select jsonb_agg(c) from b),
           'events', (select coalesce(jsonb_agg(e), '[]'::jsonb) from b, jsonb_array_elements(b.c->'events') e))
$fx$;

-- Everything a write could change on one shipment, as one fingerprint -- the
-- row, its events and its history.
create function pg_temp.zz142_print(p_ship uuid)
returns text
language sql as $fx$
  select md5((select to_jsonb(s)::text from vessl.shipments s where s.id = p_ship))
      || '/' || (select count(*)::text from vessl.shipment_tracking_events e where e.shipment_id = p_ship)
      || '/' || (select count(*)::text from vessl.order_history h where h.row_id = p_ship)
$fx$;

create temp table _probe142 (step int, result text) on commit drop;

do $probe$
declare
  s1  uuid;
  s2  uuid;
  p1  text;
  p2  text;
  r   jsonb;
  st  text;
  msg text;
begin
  -- pa, a delivered row and a live row on one ref; the second call by ref only.
  begin
    s1 := pg_temp.zz142_ship('42A1', 'ZZ142BA', 'ZZZU1420011');
    s2 := pg_temp.zz142_ship('42A2', 'ZZ142BA', 'ZZZU1420012');
    r := vessl.apply_tracking_group('ZZ142PA', 'ZZ142BA', pg_temp.zz142_payload(array['ZZZU1420011', 'ZZZU1420012'],
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), 'ZZ VESSEL', 'ZZSTATUS', null, 'GTIN'));
    update vessl.shipments set status = 'delivered' where id = s1;
    p1 := pg_temp.zz142_print(s1);
    r := vessl.apply_tracking_group('ZZ142PA', null, pg_temp.zz142_payload(array['ZZZU1420011', 'ZZZU1420012'],
           make_timestamptz(2026, 10, 26, 19, 0, 0, 'UTC'), 'ZZ OTHER VESSEL', 'ZZSTATUSTWO', 'in_transit', 'DEPA'));
    msg := 'closed ' || case when pg_temp.zz142_print(s1) = p1 then 'same' else 'changed' end
        || ' | live ' || coalesce((select s.status::text || ' eta ' || to_char(s.estimated_arrival at time zone 'UTC', 'YYYY-MM-DD')
                                     from vessl.shipments s where s.id = s2), 'none')
        || ' | rows ' || coalesce(jsonb_array_length(r->'rows')::text, 'none') || ' closed ' || coalesce(r->>'closed', 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe142 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- pb, every row on the ref delivered.
  begin
    s1 := pg_temp.zz142_ship('42B1', 'ZZ142BB', 'ZZZU1420021');
    s2 := pg_temp.zz142_ship('42B2', 'ZZ142BB', 'ZZZU1420022');
    r := vessl.apply_tracking_group('ZZ142PB', 'ZZ142BB', pg_temp.zz142_payload(array['ZZZU1420021', 'ZZZU1420022'],
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), 'ZZ VESSEL', 'ZZSTATUS', null, 'GTIN'));
    update vessl.shipments set status = 'delivered' where id in (s1, s2);
    p1 := pg_temp.zz142_print(s1);
    p2 := pg_temp.zz142_print(s2);
    r := vessl.apply_tracking_group('ZZ142PB', null, pg_temp.zz142_payload(array['ZZZU1420021', 'ZZZU1420022'],
           make_timestamptz(2026, 10, 26, 19, 0, 0, 'UTC'), 'ZZ OTHER VESSEL', 'ZZSTATUSTWO', 'in_transit', 'DEPA'));
    msg := 'rows ' || coalesce(jsonb_array_length(r->'rows')::text, 'none') || ' closed ' || coalesce(r->>'closed', 'none')
        || ' | ' || case when pg_temp.zz142_print(s1) = p1 and pg_temp.zz142_print(s2) = p2 then 'both same' else 'changed' end;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe142 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- pc, a ref no row carries.
  begin
    r := vessl.apply_tracking_group('ZZ142PC', null, pg_temp.zz142_payload(array['ZZZU1420031'],
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), 'ZZ VESSEL', 'ZZSTATUS', null, 'GTIN'));
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe142 values (3, case when st = 'P0001' then 'no error' else st end);
  end;

  -- pd, a cancelled row and a live row on one ref.
  begin
    s1 := pg_temp.zz142_ship('42D1', 'ZZ142BD', 'ZZZU1420041');
    s2 := pg_temp.zz142_ship('42D2', 'ZZ142BD', 'ZZZU1420042');
    r := vessl.apply_tracking_group('ZZ142PD', 'ZZ142BD', pg_temp.zz142_payload(array['ZZZU1420041', 'ZZZU1420042'],
           make_timestamptz(2026, 10, 24, 19, 0, 0, 'UTC'), 'ZZ VESSEL', 'ZZSTATUS', null, 'GTIN'));
    update vessl.shipments set status = 'cancelled' where id = s1;
    p1 := pg_temp.zz142_print(s1);
    r := vessl.apply_tracking_group('ZZ142PD', null, pg_temp.zz142_payload(array['ZZZU1420041', 'ZZZU1420042'],
           make_timestamptz(2026, 10, 26, 19, 0, 0, 'UTC'), 'ZZ OTHER VESSEL', 'ZZSTATUSTWO', 'in_transit', 'DEPA'));
    msg := 'cancelled ' || case when pg_temp.zz142_print(s1) = p1 then 'same' else 'changed' end
        || ' | rows ' || coalesce(jsonb_array_length(r->'rows')::text, 'none') || ' closed ' || coalesce(r->>'closed', 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe142 values (4, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

drop function pg_temp.zz142_ship(text, text, text);
drop function pg_temp.zz142_payload(text[], timestamptz, text, text, text, text);
drop function pg_temp.zz142_print(uuid);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments/notifications = ' || (select n_ship::text || '/' || n_notif::text from _pre142) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the body counts closed rows; comment 142; security definer; execute for anon, authenticated, service_role',
         (select (prosrc like '%''closed'', n_closed%')::text || '/' || (obj_description(oid, 'pg_proc') like 'Script 142.%')::text
                 || '/' || prosecdef::text
            from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text,
         'true/true/true/false/false/true'::text
  union all
  select 'b2 probes -- delivered skipped beside a live row, all closed, no ref, cancelled skipped',
         (select string_agg(result, ' || ' order by step) from _probe142),
         'closed same | live in_transit eta 2026-10-26 | rows 1 closed 1 || rows 0 closed 2 | both same || P0002 || cancelled same | rows 1 closed 1'::text
  union all
  select 'b3 existing shipments, sales orders and purchase orders unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_ship from _pre142) then 'same' else 'changed' end from vessl.shipments s)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_so from _pre142) then 'same' else 'changed' end from vessl.sales_orders o)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_po from _pre142) then 'same' else 'changed' end from vessl.purchase_orders o),
         'same/same/same'::text
  union all
  select 'b4 probes left nothing -- probe rows, events, notifications, order history',
         (select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')::text
           || '/' || ((select count(*) from vessl.shipment_tracking_events) - (select n_events from _pre142))::text
           || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre142))::text
           || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre142))::text,
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
