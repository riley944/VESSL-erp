-- 137 -- Ocean tracking (ShipsGo) on vessl.shipments, with a silent cascade.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 137r.
-- Run this BEFORE the code that uses it is deployed -- the Track button, the
-- webhook and the daily refresh call vessl.apply_tracking_update and read the
-- new columns. The code now live never names them, so this changes nothing for
-- the live site except the one line added to notify_portal_on_so_status, which
-- is inert until something sets the flag.
--
-- WHAT IT DOES.
--   1. Nine nullable columns on vessl.shipments, each with a comment --
--        tracking_provider   text  CHECK null or shipsgo
--        tracking_ref        text  the provider shipment id
--        tracking_status     text  the provider status word, raw (GATE_OUT ...)
--        tracking_vessel     text
--        tracking_voyage     text
--        tracking_eta        timestamptz
--        tracking_ata        timestamptz
--        tracking_checked_at timestamptz
--        tracking_error      text
--      plus a partial unique index on (tracking_provider, tracking_ref) where
--      tracking_ref is set, so a webhook finds exactly one shipment.
--      vessel_name, voyage_no, estimated_arrival and actual_arrival stay the
--      staff fields and tracking never writes them. actual_arrival matters most,
--      the Shipments row reads any value there as delivered.
--   2. vessl.shipment_tracking_events, one row per container, event code and
--      location, unique on (shipment_id, provider, container_number, event_code,
--      location_code) so a repeated webhook updates a row instead of adding one.
--      An estimate that becomes actual updates the same row. RLS as on
--      shipments -- auth_all and staff_only permissive, kui_staff_only
--      restrictive -- and the same table grants (the schema default).
--      vessl.tracking_events (0 rows, read by nothing) is left alone.
--   3. vessl.apply_tracking_update(p_shipment_id uuid, p_data jsonb), security
--      definer, executable by service_role ONLY. It sets vessl.suppress_client_notify
--      and vessl.change_note for its own transaction, writes the tracking
--      columns, moves status FORWARD ONLY and only within in_transit,
--      at_transshipment, at_destination_port, customs and out_for_delivery,
--      never delivered, never from delivered, cancelled, delayed or exception,
--      then upserts the events. A shipment is found by id, or by provider and
--      ref when the id is null (the webhook case).
--   4. notify_portal_on_so_status gains one first line -- return without a
--      notification while vessl.suppress_client_notify is on. Everything else
--      in it is unchanged. The SO and PO statuses still cascade from the
--      shipment, silently (decision a).
--
-- GUARDS, before any change.
--   none of the nine columns, the index, the table or the function exist
--   notify_portal_on_so_status is the body as measured (md5 3bae3322..., 402)
--   the three shipments policies are as measured, RLS on
--   no column of shipments has a column-level grant, service_role exists
--   ZZTESTER (client, name length 8) and ZZTESTFACTORY (factory, length 13)
--     as measured, and no ZZ-137-PROBE order or shipment exists
--
-- PROBES, each undone. Every probe builds its own throwaway ZZ-137-PROBE PO,
-- sales order and shipment for ZZTESTER inside a block that is always rolled
-- back, so no real order gains a history row or a notification.
--   p1 As Jenn signed in, one event on the probe shipment is visible (1).
--   p2 As a signed-in user who is not staff, it is not (0).
--   p3 As Jenn signed in, calling apply_tracking_update is refused (42501).
--   p4 The function moves a created shipment to in_transit -- the SO becomes
--      shipped, NO notification is raised, one event stored, flag reset after.
--   p5 The same move made directly raises one notification.
--   p6 Forward only -- a shipment at at_destination_port stays there when the
--      function is given in_transit, and again when given delivered;
--      actual_arrival stays empty.
--   p7 Idempotent -- the same event sent twice, EST then ACT, is one row, ACT.
--   p8 Found by provider and ref with a null id, and moved to in_transit.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

set local vessl.change_note = 'script 137 probes, throwaway ZZ-137-PROBE orders, undone';

create temp table _pre137 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%') as n_cols,
    (select count(*) from pg_indexes
      where schemaname = 'vessl' and indexname = 'shipments_tracking_ref_key')                    as n_idx,
    (select count(*) from pg_class where oid = to_regclass('vessl.shipment_tracking_events'))      as n_tbl,
    (select count(*) from pg_proc
      where pronamespace = 'vessl'::regnamespace and proname = 'apply_tracking_update')           as n_fn,
    (select md5(prosrc) || '/' || length(prosrc)::text from pg_proc
      where oid = 'vessl.notify_portal_on_so_status'::regproc)                                     as notify_src,
    (select string_agg(policyname || ' ' || permissive, ',' order by policyname) from pg_policies
      where schemaname = 'vessl' and tablename = 'shipments')                                       as pols,
    (select relrowsecurity from pg_class where oid = 'vessl.shipments'::regclass)                  as rls_on,
    (select relacl::text from pg_class where oid = 'vessl.shipments'::regclass)                    as ship_acl,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.shipments'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                               as n_colacl,
    (select count(*) from pg_roles where rolname = 'service_role')                                 as n_svc,
    (select count(*) from vessl.companies
      where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid and type = 'client' and length(name) = 8)
      + (select count(*) from vessl.companies
      where id = '5fa19444-d240-48bb-b170-98119697919a'::uuid and type = 'factory' and length(name) = 13) as n_zz,
    (select count(*) from vessl.purchase_orders where order_number = 'ZZ-137-PROBE')
      + (select count(*) from vessl.sales_orders where so_number = 'ZZ-137-PROBE')
      + (select count(*) from vessl.shipments where shipment_number = 'ZZ-137-PROBE')            as n_probe_rows,
    (select count(*) from vessl.shipments)                                                         as n_ship,
    (select count(*) from portal.notifications)                                                    as n_notif,
    -- Every row, every column, so b8 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)        as h_ship,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.sales_orders o)     as h_so,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.purchase_orders o)  as h_po,
    (select count(*) from vessl.order_history)                                                     as n_hist;

do $guard$
begin
  if (select n_cols + n_idx + n_tbl + n_fn from _pre137) <> 0 then
    raise exception 'a tracking column, the index, the events table or the function already exists, nothing changed';
  end if;
  if (select notify_src from _pre137) <> '3bae3322000d9868f9f21c5e240894e5/402' then
    raise exception 'notify_portal_on_so_status is not the body as measured, nothing changed';
  end if;
  if (select pols from _pre137) <> 'kui_staff_only RESTRICTIVE,shipments_auth_all PERMISSIVE,staff_only PERMISSIVE'
     or not (select rls_on from _pre137) then
    raise exception 'the shipments policies are not as measured, nothing changed';
  end if;
  if (select n_colacl from _pre137) <> 0 or (select n_svc from _pre137) <> 1 then
    raise exception 'shipments has a column-level grant or service_role is missing, nothing changed';
  end if;
  if (select n_zz from _pre137) <> 2 or (select n_probe_rows from _pre137) <> 0 then
    raise exception 'ZZTESTER or ZZTESTFACTORY is not as measured, or a ZZ-137-PROBE row exists, nothing changed';
  end if;
end
$guard$;

-- 1. The columns and the index.
alter table vessl.shipments
  add column tracking_provider   text,
  add column tracking_ref        text,
  add column tracking_status     text,
  add column tracking_vessel     text,
  add column tracking_voyage     text,
  add column tracking_eta        timestamptz,
  add column tracking_ata        timestamptz,
  add column tracking_checked_at timestamptz,
  add column tracking_error      text;

alter table vessl.shipments
  add constraint shipments_tracking_provider_check check (tracking_provider is null or tracking_provider = 'shipsgo');

create unique index shipments_tracking_ref_key on vessl.shipments (tracking_provider, tracking_ref)
  where tracking_ref is not null;

comment on column vessl.shipments.tracking_provider is 'Script 137. The tracking service, shipsgo, or null when the shipment is not tracked.';
comment on column vessl.shipments.tracking_ref is 'Script 137. The provider shipment id. Unique per provider; the webhook finds the shipment by it.';
comment on column vessl.shipments.tracking_status is 'Script 137. The provider status word as sent (GATE_OUT and so on). status is the mapped, forward-only value.';
comment on column vessl.shipments.tracking_vessel is 'Script 137. Vessel name from tracking. vessel_name stays the staff field.';
comment on column vessl.shipments.tracking_voyage is 'Script 137. Voyage from tracking. voyage_no stays the staff field.';
comment on column vessl.shipments.tracking_eta is 'Script 137. Discharge ETA from tracking. estimated_arrival stays the staff field.';
comment on column vessl.shipments.tracking_ata is 'Script 137. Actual arrival at the port of discharge from tracking. Never copied to actual_arrival, which the Shipments row reads as delivered.';
comment on column vessl.shipments.tracking_checked_at is 'Script 137. When tracking last wrote this row.';
comment on column vessl.shipments.tracking_error is 'Script 137. The last tracking error, null when the last check succeeded.';

-- 2. The events.
create table vessl.shipment_tracking_events (
  id               uuid primary key default gen_random_uuid(),
  shipment_id      uuid not null references vessl.shipments(id) on delete cascade,
  provider         text not null check (provider in ('shipsgo')),
  container_number text not null default '',
  event_code       text not null,
  event_status     text not null check (event_status in ('EST', 'ACT')),
  location_code    text not null default '',
  location_name    text,
  vessel_name      text,
  vessel_imo       text,
  voyage           text,
  event_time       timestamptz,
  raw              jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint shipment_tracking_events_key unique (shipment_id, provider, container_number, event_code, location_code)
);

create index shipment_tracking_events_time_idx on vessl.shipment_tracking_events (shipment_id, event_time desc);

comment on table vessl.shipment_tracking_events is 'Script 137. Container movements from tracking, one row per container, event code and location. Written by vessl.apply_tracking_update.';

alter table vessl.shipment_tracking_events enable row level security;
create policy shipment_tracking_events_auth_all on vessl.shipment_tracking_events
  as permissive for all to authenticated using (true) with check (true);
create policy staff_only on vessl.shipment_tracking_events
  as permissive for all to authenticated using (vessl.is_staff()) with check (vessl.is_staff());
create policy kui_staff_only on vessl.shipment_tracking_events
  as restrictive for all to authenticated using (portal.is_kui_staff()) with check (portal.is_kui_staff());

-- 3. The one way tracking writes.
create function vessl.apply_tracking_update(p_shipment_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = vessl, pg_temp
as $fn$
declare
  sid   uuid;
  cur   text;
  tgt   text := nullif(p_data->>'target_status', '');
  prov  text := nullif(p_data->>'provider', '');
  -- The order status moves through. delivered, cancelled, delayed and exception
  -- are not on it, so a shipment at any of them is never moved.
  ladder  text[] := array['created', 'at_origin_port', 'in_transit', 'at_transshipment',
                          'at_destination_port', 'customs', 'out_for_delivery'];
  -- What tracking may set (decision b). Nothing before departure, never delivered.
  allowed text[] := array['in_transit', 'at_transshipment', 'at_destination_port',
                          'customs', 'out_for_delivery'];
  moved boolean := false;
  n_ev  integer := 0;
begin
  -- Both for this transaction only. The flag silences notify_portal_on_so_status
  -- for the cascade the status update below sets off; change_note labels the
  -- order history rows it writes.
  perform set_config('vessl.suppress_client_notify', 'on', true);
  perform set_config('vessl.change_note', 'tracking ' || coalesce(prov, 'unknown'), true);

  if prov is null then
    raise exception 'apply_tracking_update needs a provider' using errcode = '22023';
  end if;

  if p_shipment_id is not null then
    select s.id, s.status::text into sid, cur from vessl.shipments s where s.id = p_shipment_id for update;
  else
    select s.id, s.status::text into sid, cur from vessl.shipments s
     where s.tracking_provider = prov and s.tracking_ref = nullif(p_data->>'ref', '') for update;
  end if;
  if sid is null then
    raise exception 'apply_tracking_update found no shipment' using errcode = 'P0002';
  end if;

  update vessl.shipments set
    tracking_provider   = coalesce(prov, tracking_provider),
    tracking_ref        = coalesce(nullif(p_data->>'ref', ''), tracking_ref),
    tracking_status     = nullif(p_data->>'tracking_status', ''),
    tracking_vessel     = nullif(p_data->>'vessel', ''),
    tracking_voyage     = nullif(p_data->>'voyage', ''),
    tracking_eta        = nullif(p_data->>'eta', '')::timestamptz,
    tracking_ata        = nullif(p_data->>'ata', '')::timestamptz,
    tracking_error      = nullif(p_data->>'error', ''),
    tracking_checked_at = now()
  where id = sid;

  -- FORWARD ONLY. A separate statement, so the status trigger fires only when
  -- the status really moves.
  if tgt = any(allowed) and cur = any(ladder)
     and array_position(ladder, tgt) > array_position(ladder, cur) then
    update vessl.shipments set status = tgt::vessl.container_status, updated_at = now() where id = sid;
    moved := true;
  end if;

  -- One row per container, code and location; when a payload repeats one, the
  -- actual beats the estimate and the latest time wins.
  insert into vessl.shipment_tracking_events
    (shipment_id, provider, container_number, event_code, event_status, location_code,
     location_name, vessel_name, vessel_imo, voyage, event_time, raw)
  select distinct on (cn, code, loc)
         sid, prov, cn, code, st, loc, locn, vn, imo, voy, t, rw
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
            from jsonb_array_elements(coalesce(p_data->'events', '[]'::jsonb)) e
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

  perform set_config('vessl.suppress_client_notify', '', true);

  return jsonb_build_object('shipment_id', sid, 'status_before', cur,
                            'status_after', case when moved then tgt else cur end,
                            'moved', moved, 'events', n_ev);
end
$fn$;

comment on function vessl.apply_tracking_update(uuid, jsonb) is 'Script 137. The only writer of tracking data. Service role only. Silences client notifications for its own cascade, moves status forward only (in_transit to out_for_delivery, never delivered), upserts events.';

revoke all on function vessl.apply_tracking_update(uuid, jsonb) from public, anon, authenticated;
grant execute on function vessl.apply_tracking_update(uuid, jsonb) to service_role;

-- 4. The flag check. Body otherwise exactly as measured.
create or replace function vessl.notify_portal_on_so_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'vessl', 'portal', 'public'
as $function$
begin
  if current_setting('vessl.suppress_client_notify', true) = 'on' then
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status and NEW.client_company_id is not null then
    insert into portal.notifications(kind, company_id, body, link)
    values (
      'status_update',
      NEW.client_company_id,
      'Order ' || coalesce(NEW.so_number, NEW.order_number, 'your order') || ' is now ' || replace(NEW.status, '_', ' '),
      NEW.id::text
    );
  end if;
  return NEW;
end $function$;

-- The throwaway order chain every probe builds. pg_temp, dropped below.
create function pg_temp.zz137_fixture(p_status text, out ship uuid, out so uuid)
language plpgsql as $fx$
declare
  po uuid;
begin
  insert into vessl.purchase_orders (order_number, factory_company_id, client_company_id, status)
    values ('ZZ-137-PROBE', '5fa19444-d240-48bb-b170-98119697919a'::uuid, 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'in_production')
    returning id into po;
  insert into vessl.sales_orders (so_number, client_company_id, status)
    values ('ZZ-137-PROBE', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'in_production')
    returning id into so;
  insert into vessl.sales_order_pos (sales_order_id, purchase_order_id) values (so, po);
  insert into vessl.shipments (shipment_number, status, client_company_id)
    values ('ZZ-137-PROBE', p_status::vessl.container_status, 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid)
    returning id into ship;
  insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (ship, po);
end
$fx$;

create temp table _probe137 (step int, result text) on commit drop;

do $probe$
declare
  f    record;
  n    integer;
  n0   integer;
  r    jsonb;
  st   text;
  msg  text;
  ev   jsonb;
begin
  -- p1, as Jenn -- one event on the probe shipment.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    insert into vessl.shipment_tracking_events (shipment_id, provider, event_code, event_status)
      values (f.ship, 'shipsgo', 'GTIN', 'ACT');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from vessl.shipment_tracking_events where shipment_id = f.ship;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (1, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p2, as a signed-in user who is not staff -- the same event.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    insert into vessl.shipment_tracking_events (shipment_id, provider, event_code, event_status)
      values (f.ship, 'shipsgo', 'GTIN', 'ACT');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001370', 'email', 'zz137-outsider@vessl.io', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from vessl.shipment_tracking_events where shipment_id = f.ship;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (2, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p3, as Jenn -- the function itself.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo', 'target_status', 'in_transit'));
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (3, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p4, the function -- created to in_transit, silently.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    select count(*) into n0 from portal.notifications where link = f.so::text;
    r := vessl.apply_tracking_update(f.ship, jsonb_build_object(
           'provider', 'shipsgo', 'ref', 'ZZ137P4', 'tracking_status', 'SAILING', 'target_status', 'in_transit',
           'events', jsonb_build_array(jsonb_build_object('container_number', 'ZZZU1370004', 'event_code', 'DEPA',
                                                          'event_status', 'ACT', 'location_code', 'CNXMG', 'event_time', now()))));
    select count(*) into n from portal.notifications where link = f.so::text;
    msg := (select s.status::text from vessl.shipments s where s.id = f.ship)
        || ' | ' || (select o.status from vessl.sales_orders o where o.id = f.so)
        || ' | notif +' || (n - n0)::text
        || ' | events ' || (select count(*)::text from vessl.shipment_tracking_events where shipment_id = f.ship)
        || ' | flag ' || coalesce(nullif(current_setting('vessl.suppress_client_notify', true), ''), 'off');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (4, case when st = 'P0001' then msg else st end);
  end;

  -- p5, directly -- the same move, the notification it has always raised.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    select count(*) into n0 from portal.notifications where link = f.so::text;
    update vessl.shipments set status = 'in_transit' where id = f.ship;
    select count(*) into n from portal.notifications where link = f.so::text;
    msg := (select o.status from vessl.sales_orders o where o.id = f.so) || ' | notif +' || (n - n0)::text;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (5, case when st = 'P0001' then msg else st end);
  end;

  -- p6, forward only and never delivered.
  begin
    select * into f from pg_temp.zz137_fixture('at_destination_port');
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo', 'target_status', 'in_transit'));
    msg := (select s.status::text from vessl.shipments s where s.id = f.ship);
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo', 'target_status', 'delivered'));
    msg := msg || ' | ' || (select s.status::text || ' | arrival ' || coalesce(s.actual_arrival::text, 'empty')
                              from vessl.shipments s where s.id = f.ship);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (6, case when st = 'P0001' then msg else st end);
  end;

  -- p7, the same event twice, EST then ACT.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    ev := jsonb_build_object('container_number', 'ZZZU1370007', 'event_code', 'ARRV', 'location_code', 'USOAK', 'event_time', now());
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo',
              'events', jsonb_build_array(ev || jsonb_build_object('event_status', 'EST'))));
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo',
              'events', jsonb_build_array(ev || jsonb_build_object('event_status', 'ACT'))));
    msg := (select 'events ' || count(*)::text || ' ' || coalesce(string_agg(event_status, ','), '')
              from vessl.shipment_tracking_events where shipment_id = f.ship);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (7, case when st = 'P0001' then msg else st end);
  end;

  -- p8, the webhook path -- found by provider and ref.
  begin
    select * into f from pg_temp.zz137_fixture('created');
    perform vessl.apply_tracking_update(f.ship, jsonb_build_object('provider', 'shipsgo', 'ref', 'ZZ137P8'));
    r := vessl.apply_tracking_update(null, jsonb_build_object('provider', 'shipsgo', 'ref', 'ZZ137P8', 'target_status', 'in_transit'));
    msg := case when (r->>'shipment_id')::uuid = f.ship then 'found ' else 'other ' end || (r->>'status_after');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe137 values (8, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

drop function pg_temp.zz137_fixture(text);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments/notifications = ' || (select n_ship::text || '/' || n_notif::text from _pre137) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 nine tracking columns -- all, text, timestamptz, nullable',
         (select count(*)::text || '/' || count(*) filter (where data_type = 'text')::text || '/'
                 || count(*) filter (where data_type = 'timestamp with time zone')::text || '/'
                 || count(*) filter (where is_nullable = 'YES' and column_default is null)::text
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%'),
         '9/6/3/9'::text
  union all
  select 'b2 nine column comments, the provider CHECK, the partial unique index',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.shipments'::regclass and attname like 'tracking%'
             and col_description(attrelid, attnum) like 'Script 137.%')
           || '/' || (select count(*)::text from pg_constraint
                       where conrelid = 'vessl.shipments'::regclass and conname = 'shipments_tracking_provider_check')
           || '/' || (select count(*)::text from pg_index i
                       where i.indexrelid = to_regclass('vessl.shipments_tracking_ref_key')
                         and i.indisunique and i.indpred is not null),
         '9/1/1'::text
  union all
  select 'b3 events table -- RLS on, the three policies, the same grants as shipments',
         (select relrowsecurity::text from pg_class where oid = 'vessl.shipment_tracking_events'::regclass)
           || '/' || (select string_agg(policyname || ' ' || permissive, ',' order by policyname) from pg_policies
                       where schemaname = 'vessl' and tablename = 'shipment_tracking_events')
           || '/' || (select case when relacl::text = (select ship_acl from _pre137) then 'same acl' else relacl::text end
                        from pg_class where oid = 'vessl.shipment_tracking_events'::regclass),
         'true/kui_staff_only RESTRICTIVE,shipment_tracking_events_auth_all PERMISSIVE,staff_only PERMISSIVE/same acl'::text
  union all
  select 'b4 events unique key, five columns',
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipment_tracking_events_key'),
         'UNIQUE (shipment_id, provider, container_number, event_code, location_code)'::text
  union all
  select 'b5 function -- security definer; execute for anon, authenticated, service_role',
         (select prosecdef::text from pg_proc where oid = 'vessl.apply_tracking_update(uuid,jsonb)'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text,
         'true/false/false/true'::text
  union all
  select 'b6 notify function -- flag check added, still security definer, still authenticated may execute',
         (select (prosrc like '%vessl.suppress_client_notify%')::text || '/' || prosecdef::text
                 || '/' || has_function_privilege('authenticated', oid, 'execute')::text
            from pg_proc where oid = 'vessl.notify_portal_on_so_status'::regproc),
         'true/true/true'::text
  union all
  select 'b7 probes -- staff sees, non-staff not, staff refused the function, silent move, direct move notifies, forward only, idempotent, by ref',
         (select string_agg(result, ' || ' order by step) from _probe137),
         'sees 1 || sees 0 || 42501 || in_transit | shipped | notif +0 | events 1 | flag off || shipped | notif +1 || at_destination_port | at_destination_port | arrival empty || events 1 ACT || found in_transit'::text
  union all
  select 'b8 existing shipments, sales orders and purchase orders unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'tracking_provider' - 'tracking_ref' - 'tracking_status'
                                                    - 'tracking_vessel' - 'tracking_voyage' - 'tracking_eta' - 'tracking_ata'
                                                    - 'tracking_checked_at' - 'tracking_error')::text, '/' order by s.id), ''))
                           = (select h_ship from _pre137) then 'same' else 'changed' end from vessl.shipments s)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_so from _pre137) then 'same' else 'changed' end from vessl.sales_orders o)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_po from _pre137) then 'same' else 'changed' end from vessl.purchase_orders o),
         'same/same/same'::text
  union all
  select 'b9 probes left nothing -- probe rows, events, notifications, order history',
         ((select count(*) from vessl.purchase_orders where order_number = 'ZZ-137-PROBE')
           + (select count(*) from vessl.sales_orders where so_number = 'ZZ-137-PROBE')
           + (select count(*) from vessl.shipments where shipment_number = 'ZZ-137-PROBE'))::text
           || '/' || (select count(*)::text from vessl.shipment_tracking_events)
           || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre137))::text
           || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre137))::text,
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
