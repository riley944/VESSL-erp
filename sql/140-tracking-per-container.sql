-- 140 -- Tracking per container. Every shipment on one B/L follows the same
-- ShipsGo shipment, each row its own container.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 140r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Run it BEFORE the tracking code is deployed -- that code
-- calls vessl.apply_tracking_group and the new tracking_refs_due, and nothing
-- live names either. 137 and 138 are committed and nothing calls them yet.
--
-- WHY. One B/L is often several shipments here, one per container (on 30 Oct,
-- 4 B/L groups of 2 or 3 rows and 3 booking groups of 2 to 5 rows). ShipsGo
-- tracks a B/L once, as one shipment with a containers array. The partial
-- unique index of 137 let only one of those rows carry the tracking.
--
-- WHAT IT DOES.
--   1. Drops the unique index shipments_tracking_ref_key and creates the plain
--      partial index shipments_tracking_ref_idx on the same columns. Many rows
--      share one ref now and the webhook finds them all.
--   2. Adds shipments.tracking_container text, the ShipsGo container this row
--      follows -- null when the row has no container number and follows the
--      shipment as a whole. New comment on tracking_ref.
--   3. Replaces vessl.apply_tracking_update(uuid, jsonb) with
--      vessl.apply_tracking_group(p_ref text, p_number text, p_data jsonb),
--      security definer, service_role only, the same two flags as 137.
--        Attach. When p_number is given, every shipment whose own number is
--          p_number (its B/L, else its booking number, uppercased, spaces
--          removed -- the number the Track button uses) and that is not
--          delivered or cancelled and not tracked yet gets provider and ref.
--          A sibling already tracked under another ref is left alone and
--          listed in the result as skipped.
--        Write. Every row with that provider and ref, locked in id order --
--          a row whose container is in p_data.containers takes that container
--            status word, vessel, voyage, ETA, ATA, target and events
--          a row with no container number, or any row while ShipsGo lists no
--            containers yet, takes the shipment as a whole (the least
--            advanced container, all events), as 137 did
--          a row whose container ShipsGo does not list keeps its status, gets
--            no events, and gets tracking_error naming its container and the
--            ones ShipsGo lists, so a typo shows on the row
--        Status FORWARD ONLY, exactly as 137 -- within in_transit,
--          at_transshipment, at_destination_port, customs and
--          out_for_delivery, never delivered, never from delivered, cancelled,
--          delayed or exception. actual_arrival is never written.
--        No row at all raises P0002, as 137 did.
--   4. Replaces vessl.tracking_refs_due() with one row per provider and ref
--      that has at least one row not delivered or cancelled -- provider, ref,
--      row count, oldest check -- oldest check first. Same rights as 138.
--
-- GUARDS, before any change.
--   137 and 138 committed, both function bodies as measured (md5 and length)
--   tracking_container, apply_tracking_group and the new index do not exist
--   no shipment has a tracking_ref and no tracking event exists
--   no column-level grant on shipments, service_role exists
--   ZZTESTER (client, name length 8) and ZZTESTFACTORY (factory, length 13) as
--     measured, no ZZ-140-PROBE row
--
-- PROBES, each undone. Throwaway ZZ-140-PROBE shipments for ZZTESTER.
--   p1 Three siblings on one B/L each move to their own container target; the
--      one linked to a throwaway SO cascades it silently.
--   p2 A sibling with no container number takes the least advanced target and
--      every event.
--   p3 A container ShipsGo does not list -- no move, no events, the error.
--   p4 Attach -- a delivered sibling is not attached, a booking-only sibling
--      (lowercase) is, one tracked under another ref is skipped.
--   p5 The webhook path -- ref only, no number -- moves every attached row.
--   p6 As Jenn signed in, calling apply_tracking_group is refused (42501).
--   p7 tracking_refs_due lists the ref once with its two rows, and not once
--      both are delivered.
--   p8 The same payload twice -- the same events, nothing moves the second time.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

set local vessl.change_note = 'script 140 probes, throwaway ZZ-140-PROBE shipments, undone';

create temp table _pre140 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%')  as n_cols,
    (select count(*) from pg_indexes
      where schemaname = 'vessl' and indexname = 'shipments_tracking_ref_key')                     as n_old_idx,
    (select count(*) from pg_indexes
      where schemaname = 'vessl' and indexname = 'shipments_tracking_ref_idx')                     as n_new_idx,
    (select count(*) from pg_class where oid = to_regclass('vessl.shipment_tracking_events'))       as n_tbl,
    (select md5(prosrc) || '/' || length(prosrc)::text from pg_proc
      where oid = to_regprocedure('vessl.apply_tracking_update(uuid,jsonb)'))                       as apply_src,
    (select md5(prosrc) || '/' || length(prosrc)::text from pg_proc
      where oid = to_regprocedure('vessl.tracking_refs_due()'))                                     as due_src,
    (select count(*) from pg_proc
      where pronamespace = 'vessl'::regnamespace and proname = 'apply_tracking_group')              as n_group,
    (select count(*) from vessl.shipments where tracking_ref is not null)                           as n_tracked,
    (select count(*) from vessl.shipment_tracking_events)                                           as n_events,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.shipments'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                                as n_colacl,
    (select count(*) from pg_roles where rolname = 'service_role')                                  as n_svc,
    (select count(*) from vessl.companies
      where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid and type = 'client' and length(name) = 8)
      + (select count(*) from vessl.companies
      where id = '5fa19444-d240-48bb-b170-98119697919a'::uuid and type = 'factory' and length(name) = 13) as n_zz,
    (select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')
      + (select count(*) from vessl.purchase_orders where order_number = 'ZZ-140-PROBE')
      + (select count(*) from vessl.sales_orders where so_number = 'ZZ-140-PROBE')                 as n_probe_rows,
    (select count(*) from vessl.shipments)                                                          as n_ship,
    (select count(*) from portal.notifications)                                                     as n_notif,
    -- Every row, every column, so b6 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)        as h_ship,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.sales_orders o)     as h_so,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.purchase_orders o)  as h_po,
    (select count(*) from vessl.order_history)                                                      as n_hist;

do $guard$
begin
  if (select n_cols from _pre140) <> 9 or (select n_old_idx from _pre140) <> 1 or (select n_tbl from _pre140) <> 1 then
    raise exception '137 is not committed as measured, nothing changed';
  end if;
  if (select apply_src from _pre140) is distinct from 'dfeb1c99a56d82186fb70cba266c8ecf/4691'
     or (select due_src from _pre140) is distinct from '9418f8d4b960952d48530cf8558e32e0/270' then
    raise exception 'apply_tracking_update or tracking_refs_due is not the body as measured, nothing changed';
  end if;
  if (select n_new_idx + n_group from _pre140) <> 0 then
    raise exception 'the new index or apply_tracking_group already exists, nothing changed';
  end if;
  if (select n_tracked + n_events from _pre140) <> 0 then
    raise exception 'a shipment is already tracked or a tracking event exists, nothing changed';
  end if;
  if (select n_colacl from _pre140) <> 0 or (select n_svc from _pre140) <> 1 then
    raise exception 'shipments has a column-level grant or service_role is missing, nothing changed';
  end if;
  if (select n_zz from _pre140) <> 2 or (select n_probe_rows from _pre140) <> 0 then
    raise exception 'ZZTESTER or ZZTESTFACTORY is not as measured, or a ZZ-140-PROBE row exists, nothing changed';
  end if;
end
$guard$;

-- 1. The index -- shared now, not unique.
drop index vessl.shipments_tracking_ref_key;
create index shipments_tracking_ref_idx on vessl.shipments (tracking_provider, tracking_ref)
  where tracking_ref is not null;

-- 2. The container a row follows.
alter table vessl.shipments add column tracking_container text;

comment on column vessl.shipments.tracking_container is 'Script 140. The tracked container this row follows, matched on container_no. Null when the row has no container number and follows the whole shipment, or its container is not on the tracking (see tracking_error).';
comment on column vessl.shipments.tracking_ref is 'Script 140. The provider shipment id. Every shipment on one B/L or booking shares it; the webhook finds them all by it.';

-- 3. The one way tracking writes, per container.
drop function vessl.apply_tracking_update(uuid, jsonb);

create function vessl.apply_tracking_group(p_ref text, p_number text, p_data jsonb)
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

    update vessl.shipments set
      tracking_container  = case when c is null then null else c->>'number' end,
      tracking_status     = case when unlisted then null else nullif(src->>'tracking_status', '') end,
      tracking_vessel     = nullif(src->>'vessel', ''),
      tracking_voyage     = nullif(src->>'voyage', ''),
      tracking_eta        = case when unlisted then null else nullif(src->>'eta', '')::timestamptz end,
      tracking_ata        = case when unlisted then null else nullif(src->>'ata', '')::timestamptz end,
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

comment on function vessl.apply_tracking_group(text, text, jsonb) is 'Script 140. The only writer of tracking data. Service role only. Attaches the live shipments on one B/L or booking to one tracking ref, then writes each from its own container. Silences client notifications for its own cascade, moves status forward only (in_transit to out_for_delivery, never delivered), upserts events.';

revoke all on function vessl.apply_tracking_group(text, text, jsonb) from public, anon, authenticated;
grant execute on function vessl.apply_tracking_group(text, text, jsonb) to service_role;

-- 4. The refresh list -- one row per ref.
drop function vessl.tracking_refs_due();

create function vessl.tracking_refs_due()
returns table (tracking_provider text, tracking_ref text, n_rows integer, tracking_checked_at timestamptz)
language sql
stable
security definer
set search_path = vessl, pg_temp
as $fn$
  select s.tracking_provider, s.tracking_ref, count(*)::integer, min(s.tracking_checked_at)
    from vessl.shipments s
   where s.tracking_ref is not null
   group by s.tracking_provider, s.tracking_ref
  having bool_or(s.status::text not in ('delivered', 'cancelled'))
   order by bool_and(s.tracking_checked_at is not null), min(s.tracking_checked_at), s.tracking_ref
$fn$;

comment on function vessl.tracking_refs_due() is 'Script 140. The refs the daily tracking refresh re-reads -- one row per provider and ref with at least one shipment not delivered or cancelled, oldest check first. Service role only.';

revoke all on function vessl.tracking_refs_due() from public, anon, authenticated;
grant execute on function vessl.tracking_refs_due() to service_role;

-- The probe fixtures. pg_temp, dropped below.
create function pg_temp.zz140_ship(p_tag text, p_status text, p_bl text, p_booking text, p_box text)
returns uuid
language plpgsql as $fx$
declare
  sh uuid;
begin
  insert into vessl.shipments (shipment_number, status, client_company_id, bill_of_lading, booking_number, container_no)
    values ('ZZ-140-PROBE-' || p_tag, p_status::vessl.container_status, 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid,
            p_bl, p_booking, p_box)
    returning id into sh;
  return sh;
end
$fx$;

-- A throwaway PO and SO for ZZTESTER, linked to the shipment. Returns the SO.
create function pg_temp.zz140_chain(p_ship uuid)
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

-- One container as the mapping sends it, with one actual event.
create function pg_temp.zz140_box(p_number text, p_target text, p_event text)
returns jsonb
language sql as $fx$
  select jsonb_build_object('number', p_number, 'tracking_status', 'ZZSTATUS', 'vessel', 'ZZ VESSEL', 'voyage', 'ZZ140',
           'eta', now(), 'ata', null, 'target_status', p_target,
           'events', jsonb_build_array(jsonb_build_object('container_number', p_number, 'event_code', p_event,
                       'event_status', 'ACT', 'location_code', 'ZZLOC', 'event_time', now())))
$fx$;

-- The whole payload -- the shipment summary, its containers, every event.
create function pg_temp.zz140_payload(p_target text, p_boxes jsonb)
returns jsonb
language sql as $fx$
  select jsonb_build_object('provider', 'shipsgo', 'tracking_status', 'ZZSHIP', 'vessel', 'ZZ VESSEL', 'voyage', 'ZZ140',
           'eta', now(), 'target_status', p_target, 'containers', p_boxes,
           'events', (select coalesce(jsonb_agg(ev), '[]'::jsonb)
                        from jsonb_array_elements(p_boxes) b, jsonb_array_elements(b->'events') ev))
$fx$;

create temp table _probe140 (step int, result text) on commit drop;

do $probe$
declare
  s1  uuid;
  s2  uuid;
  s3  uuid;
  s4  uuid;
  so  uuid;
  n   integer;
  n0  integer;
  r   jsonb;
  r2  jsonb;
  d   jsonb;
  st  text;
  msg text;
begin
  -- p1, three siblings, each to its own container target; the SO cascades silently.
  begin
    s1 := pg_temp.zz140_ship('1A', 'created', 'ZZ140B1', null, 'ZZZU1400011');
    s2 := pg_temp.zz140_ship('1B', 'created', 'ZZ140B1', null, 'ZZZU1400012');
    s3 := pg_temp.zz140_ship('1C', 'created', 'ZZ140B1', null, 'ZZZU1400013');
    so := pg_temp.zz140_chain(s2);
    select count(*) into n0 from portal.notifications where link = so::text;
    r := vessl.apply_tracking_group('ZZ140P1', 'ZZ140B1', pg_temp.zz140_payload('in_transit', jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400011', 'at_destination_port', 'ARRV'),
           pg_temp.zz140_box('ZZZU1400012', 'in_transit', 'DEPA'),
           pg_temp.zz140_box('ZZZU1400013', 'at_transshipment', 'LOAD'))));
    select count(*) into n from portal.notifications where link = so::text;
    msg := coalesce((select string_agg(s.status::text, ',' order by s.shipment_number) from vessl.shipments s where s.id in (s1, s2, s3)), 'none')
        || ' | following ' || coalesce((select count(*)::text from vessl.shipments s
                                         where s.id in (s1, s2, s3) and s.tracking_container = s.container_no), 'none')
        || ' | events ' || coalesce((select string_agg((select count(*) from vessl.shipment_tracking_events e where e.shipment_id = s.id)::text, ','
                                                       order by s.shipment_number)
                                       from vessl.shipments s where s.id in (s1, s2, s3)), 'none')
        || ' | so ' || coalesce((select o.status::text from vessl.sales_orders o where o.id = so), 'none')
        || ' | notif +' || coalesce((n - n0)::text, 'none')
        || ' | flag ' || coalesce(nullif(current_setting('vessl.suppress_client_notify', true), ''), 'off');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- p2, no container number -- the whole shipment.
  begin
    s1 := pg_temp.zz140_ship('2A', 'created', 'ZZ140B2', null, 'ZZZU1400021');
    s2 := pg_temp.zz140_ship('2B', 'created', 'ZZ140B2', null, null);
    r := vessl.apply_tracking_group('ZZ140P2', 'ZZ140B2', pg_temp.zz140_payload('in_transit', jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400021', 'at_destination_port', 'ARRV'),
           pg_temp.zz140_box('ZZZU1400022', 'in_transit', 'DEPA'))));
    msg := coalesce((select s.status::text || ' | ' || coalesce(s.tracking_container, 'none') || ' | events '
                            || (select count(*) from vessl.shipment_tracking_events e where e.shipment_id = s.id)::text
                       from vessl.shipments s where s.id = s2), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- p3, a container ShipsGo does not list.
  begin
    s1 := pg_temp.zz140_ship('3A', 'created', 'ZZ140B3', null, 'ZZZU1409999');
    r := vessl.apply_tracking_group('ZZ140P3', 'ZZ140B3', pg_temp.zz140_payload('in_transit', jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400031', 'at_destination_port', 'ARRV'),
           pg_temp.zz140_box('ZZZU1400032', 'in_transit', 'DEPA'))));
    msg := coalesce((select s.status::text
                            || ' | ' || case when s.tracking_error = 'Container ZZZU1409999 is not on this B/L at ShipsGo (it lists ZZZU1400031, ZZZU1400032)'
                                             then 'error ok' else coalesce(s.tracking_error, 'no error') end
                            || ' | events ' || (select count(*) from vessl.shipment_tracking_events e where e.shipment_id = s.id)::text
                            || ' | ref ' || coalesce(s.tracking_ref, 'none')
                       from vessl.shipments s where s.id = s1), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (3, case when st = 'P0001' then msg else st end);
  end;

  -- p4, attach -- live siblings by B/L or booking, not the delivered one, not one tracked elsewhere.
  begin
    s1 := pg_temp.zz140_ship('4A', 'created', 'ZZ140B4', null, 'ZZZU1400041');
    s2 := pg_temp.zz140_ship('4B', 'delivered', 'ZZ140B4', null, 'ZZZU1400042');
    s3 := pg_temp.zz140_ship('4C', 'created', null, 'zz140b4', 'ZZZU1400043');
    s4 := pg_temp.zz140_ship('4D', 'created', 'ZZ140B4', null, 'ZZZU1400044');
    update vessl.shipments set tracking_provider = 'shipsgo', tracking_ref = 'ZZ140OTHER' where id = s4;
    r := vessl.apply_tracking_group('ZZ140P4', 'ZZ140B4', pg_temp.zz140_payload(null, jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400041', null, 'GTIN'),
           pg_temp.zz140_box('ZZZU1400042', null, 'GTIN'),
           pg_temp.zz140_box('ZZZU1400043', null, 'GTIN'))));
    msg := '4A ' || coalesce((select s.tracking_ref from vessl.shipments s where s.id = s1), 'none')
        || ' | 4B ' || coalesce((select coalesce(s.tracking_ref, 'none') || ' ' || s.status::text from vessl.shipments s where s.id = s2), 'gone')
        || ' | 4C ' || coalesce((select s.tracking_ref from vessl.shipments s where s.id = s3), 'none')
        || ' | 4D ' || coalesce((select s.tracking_ref from vessl.shipments s where s.id = s4), 'none')
        || ' | skipped ' || coalesce(jsonb_array_length(r->'skipped')::text, 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (4, case when st = 'P0001' then msg else st end);
  end;

  -- p5, the webhook path -- ref only.
  begin
    s1 := pg_temp.zz140_ship('5A', 'created', 'ZZ140B5', null, 'ZZZU1400051');
    s2 := pg_temp.zz140_ship('5B', 'created', 'ZZ140B5', null, 'ZZZU1400052');
    r := vessl.apply_tracking_group('ZZ140P5', 'ZZ140B5', pg_temp.zz140_payload(null, jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400051', null, 'GTIN'),
           pg_temp.zz140_box('ZZZU1400052', null, 'GTIN'))));
    r := vessl.apply_tracking_group('ZZ140P5', null, pg_temp.zz140_payload('in_transit', jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400051', 'in_transit', 'DEPA'),
           pg_temp.zz140_box('ZZZU1400052', 'at_destination_port', 'ARRV'))));
    msg := coalesce((select string_agg(s.status::text, ',' order by s.shipment_number) from vessl.shipments s where s.id in (s1, s2)), 'none')
        || ' | rows ' || coalesce(jsonb_array_length(r->'rows')::text, 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (5, case when st = 'P0001' then msg else st end);
  end;

  -- p6, as Jenn -- the function itself.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform vessl.apply_tracking_group('ZZ140P6', null, jsonb_build_object('provider', 'shipsgo'));
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (6, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p7, the refresh list -- the ref once, then not once both are delivered.
  begin
    s1 := pg_temp.zz140_ship('7A', 'created', 'ZZ140B7', null, 'ZZZU1400071');
    s2 := pg_temp.zz140_ship('7B', 'created', 'ZZ140B7', null, 'ZZZU1400072');
    r := vessl.apply_tracking_group('ZZ140P7', 'ZZ140B7', pg_temp.zz140_payload(null, jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400071', null, 'GTIN'),
           pg_temp.zz140_box('ZZZU1400072', null, 'GTIN'))));
    msg := 'listed ' || coalesce((select count(*)::text || ' rows ' || coalesce(max(q.n_rows)::text, 'none')
                                    from vessl.tracking_refs_due() q where q.tracking_ref = 'ZZ140P7'), 'none');
    update vessl.shipments set status = 'delivered' where id in (s1, s2);
    msg := msg || ' | delivered ' || coalesce((select count(*)::text from vessl.tracking_refs_due() q where q.tracking_ref = 'ZZ140P7'), 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (7, case when st = 'P0001' then msg else st end);
  end;

  -- p8, the same payload twice.
  begin
    s1 := pg_temp.zz140_ship('8A', 'created', 'ZZ140B8', null, 'ZZZU1400081');
    s2 := pg_temp.zz140_ship('8B', 'created', 'ZZ140B8', null, 'ZZZU1400082');
    d := pg_temp.zz140_payload('in_transit', jsonb_build_array(
           pg_temp.zz140_box('ZZZU1400081', 'in_transit', 'DEPA'),
           pg_temp.zz140_box('ZZZU1400082', 'in_transit', 'DEPA')));
    r := vessl.apply_tracking_group('ZZ140P8', 'ZZ140B8', d);
    select count(*) into n0 from vessl.shipment_tracking_events where shipment_id in (s1, s2);
    r2 := vessl.apply_tracking_group('ZZ140P8', 'ZZ140B8', d);
    select count(*) into n from vessl.shipment_tracking_events where shipment_id in (s1, s2);
    msg := 'events ' || coalesce(n0::text, 'none') || ' then ' || coalesce(n::text, 'none')
        || ' | moved ' || coalesce(r->>'moved', 'none') || ' then ' || coalesce(r2->>'moved', 'none');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe140 values (8, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

drop function pg_temp.zz140_ship(text, text, text, text, text);
drop function pg_temp.zz140_chain(uuid);
drop function pg_temp.zz140_box(text, text, text);
drop function pg_temp.zz140_payload(text, jsonb);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments/notifications = ' || (select n_ship::text || '/' || n_notif::text from _pre140) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 ten tracking columns, tracking_container text and nullable, both new comments',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%')
           || '/' || (select data_type || ' ' || is_nullable from information_schema.columns
                       where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'tracking_container')
           || '/' || (select count(*)::text from pg_attribute
                       where attrelid = 'vessl.shipments'::regclass and attname in ('tracking_container', 'tracking_ref')
                         and col_description(attrelid, attnum) like 'Script 140.%'),
         '10/text YES/2'::text
  union all
  select 'b2 unique index gone, the plain partial index in its place',
         (select count(*)::text from pg_indexes where schemaname = 'vessl' and indexname = 'shipments_tracking_ref_key')
           || '/' || (select count(*)::text || ' ' || coalesce(bool_and(i.indisunique)::text, 'none') || ' ' || coalesce(bool_and(i.indpred is not null)::text, 'none')
                        from pg_index i where i.indexrelid = to_regclass('vessl.shipments_tracking_ref_idx')),
         '0/1 false true'::text
  union all
  select 'b3 apply_tracking_update gone; apply_tracking_group security definer, execute for anon, authenticated, service_role',
         coalesce(to_regprocedure('vessl.apply_tracking_update(uuid,jsonb)')::text, 'none')
           || '/' || (select prosecdef::text from pg_proc where oid = 'vessl.apply_tracking_group(text,text,jsonb)'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.apply_tracking_group(text,text,jsonb)', 'execute')::text,
         'none/true/false/false/true'::text
  union all
  select 'b4 tracking_refs_due security definer, stable, the new columns; execute for anon, authenticated, service_role',
         (select prosecdef::text || '/' || provolatile::text || '/' || array_to_string(proargnames, ',')
            from pg_proc where oid = 'vessl.tracking_refs_due()'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.tracking_refs_due()', 'execute')::text,
         'true/s/tracking_provider,tracking_ref,n_rows,tracking_checked_at/false/false/true'::text
  union all
  select 'b5 probes -- per container, whole shipment, unlisted, attach, by ref, staff refused, refresh list, twice',
         (select string_agg(result, ' || ' order by step) from _probe140),
         'at_destination_port,in_transit,at_transshipment | following 3 | events 1,1,1 | so shipped | notif +0 | flag off || in_transit | none | events 2 || created | error ok | events 0 | ref ZZ140P3 || 4A ZZ140P4 | 4B none delivered | 4C ZZ140P4 | 4D ZZ140OTHER | skipped 1 || in_transit,at_destination_port | rows 2 || 42501 || listed 1 rows 2 | delivered 0 || events 2 then 2 | moved 2 then 0'::text
  union all
  select 'b6 existing shipments, sales orders and purchase orders unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'tracking_container')::text, '/' order by s.id), ''))
                           = (select h_ship from _pre140) then 'same' else 'changed' end from vessl.shipments s)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_so from _pre140) then 'same' else 'changed' end from vessl.sales_orders o)
           || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), ''))
                                     = (select h_po from _pre140) then 'same' else 'changed' end from vessl.purchase_orders o),
         'same/same/same'::text
  union all
  select 'b7 probes left nothing -- probe rows, events, notifications, order history',
         ((select count(*) from vessl.shipments where shipment_number like 'ZZ-140-PROBE%')
           + (select count(*) from vessl.purchase_orders where order_number = 'ZZ-140-PROBE')
           + (select count(*) from vessl.sales_orders where so_number = 'ZZ-140-PROBE'))::text
           || '/' || (select count(*)::text from vessl.shipment_tracking_events)
           || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre140))::text
           || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre140))::text,
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
