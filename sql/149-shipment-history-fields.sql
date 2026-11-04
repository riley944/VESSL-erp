-- 149 -- Shipment order history also records the numbers and the mode.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 149r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Independent of any code release.
--
-- WHY. Shipment history records status, ETD and ETA only, so an edit to the
-- B/L, container, booking or mode leaves updated_at moved and no record of who
-- made it (the FedEx air row KUI-PO-2026-001, 4 Nov 00.17 UTC).
--
-- WHAT IT DOES. vessl.record_order_history, the one trigger function behind
-- trg_order_history on purchase_orders, sales_orders and shipments, gets ONE
-- change -- the shipments field list grows from
--   status, estimated_departure, estimated_arrival
-- to
--   status, estimated_departure, estimated_arrival,
--   container_no, bill_of_lading, booking_number, transport_mode
-- The body is rebuilt from the live body by replacing that one array, so every
-- other byte (line endings included) stays as it is -- the staff attribution
-- (actor_id and actor_email from the JWT, db_role, app_name, via, change_note)
-- is the same code. Owner, rights, search_path and security definer are kept
-- (create or replace keeps owner and rights; the header is written as it reads).
-- The purchase order and sales order lists are untouched. No row of any table
-- changes; history rows are written only by later edits.
--
-- On an insert the trigger logs every listed field that is not null, as it
-- does for status today, so a new shipment now also gets rows for its numbers
-- and its mode. Tracking never writes these four columns.
--
-- GUARDS, before any change.
--   record_order_history is the live body (md5 38a761d3.../1918)
--   the shipments array occurs exactly once in it
--   trg_order_history sits on the three tables as measured on 4 Nov
--   no ZZ-149-PROBE shipment, the ZZTESTER client exists
--
-- PROBES, each undone. Throwaway ZZ-149-PROBE shipments, signed in as Matt.
--   pa insert -- status and the three numbers and the mode, each as Matt
--   pb an update of the three numbers and the mode -- four rows, old and new
--   pc an update of vessel_name alone -- no row
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;
set local vessl.change_note = 'script 149 Matt';

create temp table _pre149 on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.record_order_history()'))                                        as h_fn,
    (select (length(prosrc) - length(replace(prosrc, $q$array['status', 'estimated_departure', 'estimated_arrival']$q$, '')))
            / length($q$array['status', 'estimated_departure', 'estimated_arrival']$q$)
       from pg_proc where oid = to_regprocedure('vessl.record_order_history()'))                          as n_arr,
    (select p.prosecdef::text || '/' || p.proowner::regrole::text || '/' || coalesce(p.proacl::text, 'none')
            || '/' || coalesce(p.proconfig::text, 'none') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), 'none')
       from pg_proc p where p.oid = to_regprocedure('vessl.record_order_history()'))                      as h_meta,
    (select string_agg(c.relname || ' ' || md5(pg_get_triggerdef(t.oid)), ', ' order by c.relname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgfoid = to_regprocedure('vessl.record_order_history()') and not t.tgisinternal)            as h_trg,
    (select count(*) from vessl.shipments where shipment_number like 'ZZ-149-PROBE%')                      as n_probe,
    (select count(*) from vessl.companies where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid)          as n_client,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)     as h_ships,
    (select count(*) from vessl.order_history)                                                             as n_hist,
    (select count(*) from portal.notifications)                                                            as n_notif;

do $guard$
begin
  if (select h_fn from _pre149) is distinct from '38a761d32ea39360d61880a8962547ea/1918' then
    raise exception 'record_order_history is not the body measured on 4 Nov, nothing changed';
  end if;
  if (select n_arr from _pre149) <> 1 then
    raise exception 'the shipments field list does not occur exactly once, nothing changed';
  end if;
  if (select h_trg from _pre149) is null
     or (select h_trg from _pre149) not like 'purchase_orders %, sales_orders %, shipments %' then
    raise exception 'trg_order_history is not on the three order tables as measured, nothing changed';
  end if;
  if (select n_probe from _pre149) <> 0 or (select n_client from _pre149) <> 1 then
    raise exception 'a ZZ-149-PROBE shipment exists or ZZTESTER is missing, nothing changed';
  end if;
end
$guard$;

-- The function, the live body with the one array replaced.
do $fn$
declare
  body text;
begin
  select replace(prosrc,
                 $q$array['status', 'estimated_departure', 'estimated_arrival']$q$,
                 $q$array['status', 'estimated_departure', 'estimated_arrival', 'container_no', 'bill_of_lading', 'booking_number', 'transport_mode']$q$)
    into body
    from pg_proc where oid = 'vessl.record_order_history()'::regprocedure;
  execute 'create or replace function vessl.record_order_history() returns trigger language plpgsql'
       || ' security definer set search_path to vessl, pg_temp as ' || quote_literal(body);
end
$fn$;

-- The probe fixture. pg_temp, gone at the end of the session.
create function pg_temp.zz149_ship(p_tag text)
returns uuid
language plpgsql as $fx$
declare
  sh uuid;
begin
  insert into vessl.shipments (shipment_number, status, client_company_id, transport_mode, bill_of_lading, container_no, booking_number)
    values ('ZZ-149-PROBE-' || p_tag, 'created', 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid, 'ocean', 'ZZ149BL', 'ZZZU1490011', 'ZZ149BK')
    returning id into sh;
  return sh;
end
$fx$;

-- What history holds for one shipment and one action, in one line.
create function pg_temp.zz149_hist(p_id uuid, p_action text)
returns text
language sql as $fx$
  select count(*)::text || ' rows'
         || coalesce(' ' || string_agg(h.field || ' ' || coalesce(h.old_value, 'null') || ' to ' || coalesce(h.new_value, 'null'), ', ' order by h.field), '')
         || ' by ' || coalesce(string_agg(distinct h.actor_email, ','), 'nobody')
         || ' note ' || coalesce(string_agg(distinct h.note, ','), 'none')
    from vessl.order_history h
   where h.table_name = 'shipments' and h.row_id = p_id and h.action = p_action
$fx$;

create temp table _probe149 (step int, result text) on commit drop;

do $probe$
declare
  s1  uuid;
  st  text;
  msg text;
begin
  -- Signed in as Matt for the probes, so the attribution is the one staff edits get.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'cd479d49-0662-48f4-9958-f649b7fd8638', 'email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- pa, insert.
  begin
    s1 := pg_temp.zz149_ship('PA');
    msg := pg_temp.zz149_hist(s1, 'insert');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe149 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- pb, the three numbers and the mode, with vessel_name alongside.
  begin
    s1 := pg_temp.zz149_ship('PB');
    update vessl.shipments set container_no = 'ZZZU1490022', bill_of_lading = 'ZZ149BL2', booking_number = null,
                               transport_mode = 'air', vessel_name = 'ZZ VESSEL'
     where id = s1;
    msg := pg_temp.zz149_hist(s1, 'update');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe149 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- pc, vessel_name alone.
  begin
    s1 := pg_temp.zz149_ship('PC');
    update vessl.shipments set vessel_name = 'ZZ VESSEL' where id = s1;
    msg := pg_temp.zz149_hist(s1, 'update');
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe149 values (3, case when st = 'P0001' then msg else st end);
  end;

  perform set_config('request.jwt.claims', '', true);
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, record_order_history = ' || (select h_fn from _pre149) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the body -- as written here, and the live body but for the shipments array',
         (select md5(prosrc) || '/' || length(prosrc) || ' '
                 || md5(replace(prosrc,
                      $q$array['status', 'estimated_departure', 'estimated_arrival', 'container_no', 'bill_of_lading', 'booking_number', 'transport_mode']$q$,
                      $q$array['status', 'estimated_departure', 'estimated_arrival']$q$))
            from pg_proc where oid = 'vessl.record_order_history()'::regprocedure),
         '46dfbdd2a1bf5e023bac57d36bc39503/1988 38a761d32ea39360d61880a8962547ea'::text
  union all
  select 'b2 security definer, owner, rights, search_path and comment as before',
         (select p.prosecdef::text || '/' || p.proowner::regrole::text || '/' || coalesce(p.proacl::text, 'none')
                 || '/' || coalesce(p.proconfig::text, 'none') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), 'none')
            from pg_proc p where p.oid = 'vessl.record_order_history()'::regprocedure),
         (select h_meta from _pre149)
  union all
  select 'b3 trg_order_history on the three tables as before',
         (select string_agg(c.relname || ' ' || md5(pg_get_triggerdef(t.oid)), ', ' order by c.relname)
            from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where t.tgfoid = 'vessl.record_order_history()'::regprocedure and not t.tgisinternal),
         (select h_trg from _pre149)
  union all
  select 'b4 probes -- insert, the four fields updated, vessel_name alone',
         (select string_agg(result, ' || ' order by step) from _probe149),
         ('5 rows bill_of_lading null to ZZ149BL, booking_number null to ZZ149BK, container_no null to ZZZU1490011, status null to created, transport_mode null to ocean by mattdillon@kinguniversal.com note script 149 Matt'
          || ' || 4 rows bill_of_lading ZZ149BL to ZZ149BL2, booking_number ZZ149BK to null, container_no ZZZU1490011 to ZZZU1490022, transport_mode ocean to air by mattdillon@kinguniversal.com note script 149 Matt'
          || ' || 0 rows by nobody note none')::text
  union all
  select 'b5 no row changed, no history, no notification',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_ships from _pre149) then 'same' else 'changed' end from vessl.shipments s)
         || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre149))::text
         || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre149))::text
         || '/' || (select count(*) from vessl.shipments where shipment_number like 'ZZ-149-PROBE%')::text,
         'same/0/0/0'::text
  union all
  select 'z0 verification ran, record_order_history = '
         || (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.record_order_history()'::regprocedure),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
