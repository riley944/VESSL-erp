-- 140r -- Reverse of 140. Back to one shipment per tracking.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the Track button, the webhook and the daily refresh
-- call vessl.apply_tracking_group and read tracking_container and the new
-- tracking_refs_due, and fail once they are gone.
--
-- WHAT IT DOES.
--   drops vessl.apply_tracking_group and recreates vessl.apply_tracking_update
--     exactly as 137 made it (body md5 dfeb1c99..., length 4691), service_role only
--   drops vessl.tracking_refs_due and recreates it exactly as 138 made it (body
--     md5 9418f8d4..., length 270), service_role only
--   drops shipments_tracking_ref_idx and recreates the partial unique index
--     shipments_tracking_ref_key of 137
--   puts back the 137 comment on tracking_ref and drops tracking_container (a0
--     counts the rows that lose the container they followed)
-- Tracking columns, events and statuses already written stay. No other column,
-- no other row.
--
-- GUARDS, before any change.
--   140 committed -- tracking_container, apply_tracking_group and the new index
--     exist, the unique index does not
--   no tracking ref is shared by two or more shipments, or the unique index
--     cannot come back -- untrack the siblings first
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'tracking_container') <> 1
     or to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)') is null
     or to_regclass('vessl.shipments_tracking_ref_idx') is null
     or to_regclass('vessl.shipments_tracking_ref_key') is not null then
    raise exception 'the 140 column, function and index are not all there, so 140 was not committed, nothing changed';
  end if;
  if (select count(*) from (select 1 from vessl.shipments where tracking_ref is not null
                             group by tracking_provider, tracking_ref having count(*) > 1) g) <> 0 then
    raise exception 'a tracking ref is shared by two or more shipments, the unique index cannot come back, nothing changed';
  end if;
end
$guard$;

create temp table _pre140r on commit drop as
  select
    (select count(*) from vessl.shipments where tracking_container is not null)                  as n_following,
    (select count(*) from vessl.shipments)                                                        as n_ship,
    -- Every row, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(s) - 'tracking_container')::text, '/' order by s.id), ''))
       from vessl.shipments s)                                                                    as h_rest;

-- The 140 function out, the 137 function back exactly as 137 made it.
drop function vessl.apply_tracking_group(text, text, jsonb);

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

-- The 140 refresh list out, the 138 one back exactly as 138 made it.
drop function vessl.tracking_refs_due();

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

-- The index, the comment, the column.
drop index vessl.shipments_tracking_ref_idx;
create unique index shipments_tracking_ref_key on vessl.shipments (tracking_provider, tracking_ref)
  where tracking_ref is not null;
comment on column vessl.shipments.tracking_ref is 'Script 137. The provider shipment id. Unique per provider; the webhook finds the shipment by it.';
alter table vessl.shipments drop column tracking_container;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments that lose the container they followed = '
           || (select n_following::text from _pre140r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 nine tracking columns, tracking_container gone, the 137 comment on tracking_ref',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%')
           || '/' || (select count(*)::text from pg_attribute
                       where attrelid = 'vessl.shipments'::regclass and attname = 'tracking_ref'
                         and col_description(attrelid, attnum) like 'Script 137.%'),
         '9/1'::text
  union all
  select 'b2 the unique partial index back, the plain one gone',
         (select count(*)::text || ' ' || coalesce(bool_and(i.indisunique)::text, 'none') || ' ' || coalesce(bool_and(i.indpred is not null)::text, 'none')
            from pg_index i where i.indexrelid = to_regclass('vessl.shipments_tracking_ref_key'))
           || '/' || coalesce(to_regclass('vessl.shipments_tracking_ref_idx')::text, 'none'),
         '1 true true/none'::text
  union all
  select 'b3 apply_tracking_group gone; apply_tracking_update the 137 body, security definer, execute for anon, authenticated, service_role',
         coalesce(to_regprocedure('vessl.apply_tracking_group(text,text,jsonb)')::text, 'none')
           || '/' || (select md5(prosrc) || '/' || length(prosrc)::text || '/' || prosecdef::text
                        from pg_proc where oid = 'vessl.apply_tracking_update(uuid,jsonb)'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.apply_tracking_update(uuid,jsonb)', 'execute')::text,
         'none/dfeb1c99a56d82186fb70cba266c8ecf/4691/true/false/false/true'::text
  union all
  select 'b4 tracking_refs_due the 138 body and columns, stable; execute for anon, authenticated, service_role',
         (select md5(prosrc) || '/' || length(prosrc)::text || '/' || provolatile::text || '/' || array_to_string(proargnames, ',')
            from pg_proc where oid = 'vessl.tracking_refs_due()'::regprocedure)
           || '/' || has_function_privilege('anon', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('authenticated', 'vessl.tracking_refs_due()', 'execute')::text
           || '/' || has_function_privilege('service_role', 'vessl.tracking_refs_due()', 'execute')::text,
         '9418f8d4b960952d48530cf8558e32e0/270/s/shipment_id,tracking_provider,tracking_ref,status,tracking_checked_at/false/false/true'::text
  union all
  select 'b5 every other shipment column unchanged, same number of shipments',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_rest from _pre140r) then 'same' else 'changed' end
            from vessl.shipments s)
           || '/' || (select count(*)::text from vessl.shipments),
         'same/' || (select n_ship::text from _pre140r)
  union all
  select 'z0 verification ran, shipments = ' || (select count(*)::text from vessl.shipments),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
