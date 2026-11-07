-- 146 -- Shipments and orders stop moving each other.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 146r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. No code change is needed with it.
--
-- WHY. A shipment status and an order status are different facts. Two triggers
-- tied them together and both did harm once tracking moved shipments.
--   trg_sync_shipment_status (shipment to PO and SO) moved every linked PO and
--   SO to shipped or delivered on any shipment status change, from staff or from
--   tracking.
--   trg_sync_so_status_down (SO to POs and shipments) set every shipment of an
--   SO to in_transit when the SO became shipped -- dropping a tracked shipment
--   at its port of discharge back to in transit, which tracking cannot undo --
--   and to delivered, with actual_arrival now, when the SO became delivered,
--   invoiced or closed, even with the container still at the port.
--
-- WHAT IT DOES.
--   1. Drops trigger trg_sync_shipment_status on vessl.shipments. Its function
--      vessl.sync_shipment_status() stays, unattached and unchanged.
--   2. Renames vessl.sync_so_status_down() to sync_so_status_down_pre146 -- the
--      live body kept byte for byte, so 146r restores it exactly -- and creates
--      a new vessl.sync_so_status_down() that does the SO to PO half only -- the
--      same po_target mapping, the same type check, the same update of the SOs
--      POs (not closed or cancelled). The shipments half is gone. The update is
--      written as one line, which is the same statement. Trigger
--      trg_sync_so_status_down is dropped and created again on the new function,
--      same name, same event, so it fires in the same order as before.
-- Untouched -- the rest of SO and PO status sync, exactly as is.
--   trg_sync_so_to_po (SO to PO), trg_sync_po_to_so (PO to SO),
--   trg_sync_status_on_link (link), trg_notify_portal_on_so_status, and every
--   trg_order_history. No row of any table changes.
--
-- AFTER IT. A shipment status (staff or tracking) changes the shipment only. An
-- SO or PO status changes the orders only. Staff set a delivered SO by hand, as
-- they set its other statuses.
--
-- GUARDS, before any change.
--   both functions hold the live bodies measured on 3 Nov (md5 and length)
--   both triggers exist as measured; sync_so_status_down_pre146 does not
--   the other sync functions hold their measured bodies
--   ZZ PO KUI-PO-2026-003ZZTEST and ZZ SO KUI-SO-2026-014 as measured, linked,
--   both shipped; no ZZ-146-PROBE shipment
--
-- PROBES, each undone. Each makes a throwaway shipment ZZ-146-PROBE linked to
-- the ZZ PO, so it reaches the ZZ SO.
--   p1 shipment to delivered -- PO and SO stay shipped
--   p2 SO to delivered -- the shipment stays in_transit with no actual_arrival,
--      the PO goes delivered (SO to PO kept)
--   p3 shipment at_destination_port, SO to in_production then back to shipped --
--      the shipment stays at_destination_port, the PO follows to shipped
--   p4 PO to delivered -- the SO goes delivered (PO to SO kept), the shipment
--      stays in_transit
--   p5 SO to invoiced -- the shipment stays in_transit with no actual_arrival,
--      the PO goes invoiced
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre146 on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = to_regprocedure('vessl.sync_shipment_status()'))   as h_ship_fn,
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = to_regprocedure('vessl.sync_so_status_down()'))    as h_down_fn,
    (select count(*) from pg_proc where oid = to_regprocedure('vessl.sync_so_status_down_pre146()'))                         as n_pre146,
    (select count(*) from pg_trigger
      where tgname = 'trg_sync_shipment_status' and tgrelid = 'vessl.shipments'::regclass
        and tgfoid = to_regprocedure('vessl.sync_shipment_status()'))                                                       as n_trg_ship,
    (select count(*) from pg_trigger
      where tgname = 'trg_sync_so_status_down' and tgrelid = 'vessl.sales_orders'::regclass
        and tgfoid = to_regprocedure('vessl.sync_so_status_down()'))                                                        as n_trg_down,
    (select pg_get_triggerdef(oid) from pg_trigger
      where tgname = 'trg_sync_so_status_down' and tgrelid = 'vessl.sales_orders'::regclass)                                as def_down,
    (select string_agg(p.proname || ' ' || md5(p.prosrc), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'vessl'::regnamespace
        and p.proname in ('sync_so_to_po', 'sync_po_to_so', 'sync_status_on_link', 'notify_portal_on_so_status', 'record_order_history')) as h_others,
    (select string_agg(c.relname || ' ' || t.tgname, ', ' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'vessl'::regnamespace and not t.tgisinternal
        and c.relname in ('shipments', 'purchase_orders', 'sales_orders', 'shipment_pos', 'sales_order_pos'))               as triggers_before,
    (select count(*) from vessl.purchase_orders
      where id = '3f38ef06-7037-4428-badd-003b52edf2ef' and order_number = 'KUI-PO-2026-003ZZTEST'
        and length(order_number) = 21 and status::text = 'shipped')                                                         as n_po,
    (select count(*) from vessl.sales_orders
      where id = 'c1f66946-413f-48d6-b644-d62daab16935' and so_number = 'KUI-SO-2026-014'
        and length(so_number) = 15 and status::text = 'shipped')                                                            as n_so,
    (select count(*) from vessl.sales_order_pos
      where sales_order_id = 'c1f66946-413f-48d6-b644-d62daab16935' and purchase_order_id = '3f38ef06-7037-4428-badd-003b52edf2ef') as n_link,
    (select count(*) from vessl.shipments where shipment_number = 'ZZ-146-PROBE')                                           as n_probe,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)                       as h_ships,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.purchase_orders p)                 as h_pos,
    (select md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) from vessl.sales_orders o)                    as h_sos,
    (select count(*) from portal.notifications)                                                                              as n_notif,
    (select count(*) from vessl.order_history)                                                                               as n_hist;

do $guard$
begin
  if (select h_ship_fn from _pre146) is distinct from 'ab3b5f4d7a49921153e67937a1c851eb/1682'
     or (select h_down_fn from _pre146) is distinct from 'd20e88485af499d009533b83aded4bff/2252' then
    raise exception 'the two sync functions are not the bodies measured on 3 Nov, nothing changed';
  end if;
  if (select n_trg_ship from _pre146) <> 1 or (select n_trg_down from _pre146) <> 1 or (select n_pre146 from _pre146) <> 0 then
    raise exception 'the triggers are not as measured, or 146 already ran, nothing changed';
  end if;
  if (select h_others from _pre146) is distinct from
     'notify_portal_on_so_status 87eb38cb37063f414418b307601aeb52, record_order_history 38a761d32ea39360d61880a8962547ea, sync_po_to_so 5bc01b099896ad1c6409519ba7ceefea, sync_so_to_po 383507bfe87498dc9266054a7ef63de9, sync_status_on_link e4f7f70e939e8c99a8f8d34c2897a399' then
    raise exception 'another sync function is not the body measured, nothing changed';
  end if;
  if (select n_po from _pre146) <> 1 or (select n_so from _pre146) <> 1 or (select n_link from _pre146) <> 1 or (select n_probe from _pre146) <> 0 then
    raise exception 'the ZZ PO and SO are not as measured, or a ZZ-146-PROBE shipment exists, nothing changed';
  end if;
end
$guard$;

-- 1. shipment to orders, off
drop trigger trg_sync_shipment_status on vessl.shipments;
comment on function vessl.sync_shipment_status() is 'Script 146. Not attached to any trigger -- a shipment status no longer moves its POs or SOs. Kept for 146r.';

-- 2. SO to shipments, off; SO to PO kept
drop trigger trg_sync_so_status_down on vessl.sales_orders;
alter function vessl.sync_so_status_down() rename to sync_so_status_down_pre146;
comment on function vessl.sync_so_status_down_pre146() is 'Script 146. The body sync_so_status_down had before 146, kept byte for byte and not attached to any trigger, so 146r can restore it exactly.';

create function vessl.sync_so_status_down()
returns trigger
language plpgsql
security definer
as $fn$
declare
  po_target text; po_type text;
begin
  if pg_trigger_depth() > 1 then return NEW; end if;
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  po_target := case
    when NEW.status::text in ('delivered','closed') then 'delivered'
    when NEW.status::text = 'invoiced' then 'invoiced'
    when NEW.status::text = 'shipped' then 'shipped'
    when NEW.status::text = 'in_production' then 'in_production'
    when NEW.status::text = 'testing' then 'testing'
    when NEW.status::text = 'confirmed' then 'confirmed'
    else null end;

  select format_type(a.atttypid, a.atttypmod) into po_type
    from pg_attribute a where a.attrelid = 'vessl.purchase_orders'::regclass and a.attname = 'status';

  if po_target is not null and vessl.label_ok(po_type, po_target) then
    execute format('update vessl.purchase_orders po set status = %L::%s from vessl.sales_order_pos sop where sop.sales_order_id = %L and sop.purchase_order_id = po.id and po.status::text not in (%L, %L) and po.status::text <> %L',
                   po_target, po_type, NEW.id, 'closed', 'cancelled', po_target);
  end if;

  return NEW;
end
$fn$;

comment on function vessl.sync_so_status_down() is 'Script 146. An SO status moves its POs (not closed or cancelled), as before 146. It no longer touches shipments. The pre-146 body is sync_so_status_down_pre146.';

create trigger trg_sync_so_status_down after update of status on vessl.sales_orders
  for each row execute function vessl.sync_so_status_down();

create temp table _probe146 (step int, result text) on commit drop;

do $probe$
declare
  st  text;
  sh  uuid;
  msg text;
begin
  -- p1, shipment to delivered.
  begin
    insert into vessl.shipments (shipment_number, status) values ('ZZ-146-PROBE', 'in_transit') returning id into sh;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (sh, '3f38ef06-7037-4428-badd-003b52edf2ef');
    update vessl.shipments set status = 'delivered' where id = sh;
    select 'PO ' || (select status::text from vessl.purchase_orders where id = '3f38ef06-7037-4428-badd-003b52edf2ef')
        || ' SO ' || (select status::text from vessl.sales_orders where id = 'c1f66946-413f-48d6-b644-d62daab16935') into msg;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe146 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- p2, SO to delivered.
  begin
    insert into vessl.shipments (shipment_number, status) values ('ZZ-146-PROBE', 'in_transit') returning id into sh;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (sh, '3f38ef06-7037-4428-badd-003b52edf2ef');
    update vessl.sales_orders set status = 'delivered' where id = 'c1f66946-413f-48d6-b644-d62daab16935';
    select 'ship ' || s.status::text || ' ' || coalesce(s.actual_arrival::text, 'no arrival')
        || ' PO ' || (select status::text from vessl.purchase_orders where id = '3f38ef06-7037-4428-badd-003b52edf2ef')
      into msg from vessl.shipments s where s.id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe146 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- p3, a shipment at its port while the SO goes back and to shipped again.
  begin
    insert into vessl.shipments (shipment_number, status) values ('ZZ-146-PROBE', 'at_destination_port') returning id into sh;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (sh, '3f38ef06-7037-4428-badd-003b52edf2ef');
    update vessl.sales_orders set status = 'in_production' where id = 'c1f66946-413f-48d6-b644-d62daab16935';
    update vessl.sales_orders set status = 'shipped' where id = 'c1f66946-413f-48d6-b644-d62daab16935';
    select 'ship ' || s.status::text
        || ' PO ' || (select status::text from vessl.purchase_orders where id = '3f38ef06-7037-4428-badd-003b52edf2ef')
      into msg from vessl.shipments s where s.id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe146 values (3, case when st = 'P0001' then msg else st end);
  end;

  -- p4, PO to delivered.
  begin
    insert into vessl.shipments (shipment_number, status) values ('ZZ-146-PROBE', 'in_transit') returning id into sh;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (sh, '3f38ef06-7037-4428-badd-003b52edf2ef');
    update vessl.purchase_orders set status = 'delivered' where id = '3f38ef06-7037-4428-badd-003b52edf2ef';
    select 'SO ' || (select status::text from vessl.sales_orders where id = 'c1f66946-413f-48d6-b644-d62daab16935')
        || ' ship ' || s.status::text
      into msg from vessl.shipments s where s.id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe146 values (4, case when st = 'P0001' then msg else st end);
  end;

  -- p5, SO to invoiced.
  begin
    insert into vessl.shipments (shipment_number, status) values ('ZZ-146-PROBE', 'in_transit') returning id into sh;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) values (sh, '3f38ef06-7037-4428-badd-003b52edf2ef');
    update vessl.sales_orders set status = 'invoiced' where id = 'c1f66946-413f-48d6-b644-d62daab16935';
    select 'ship ' || s.status::text || ' ' || coalesce(s.actual_arrival::text, 'no arrival')
        || ' PO ' || (select status::text from vessl.purchase_orders where id = '3f38ef06-7037-4428-badd-003b52edf2ef')
      into msg from vessl.shipments s where s.id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe146 values (5, case when st = 'P0001' then msg else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, triggers = ' || (select triggers_before from _pre146) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 shipment trigger gone; the SO trigger on the new function, same definition',
         (select count(*)::text from pg_trigger where tgname = 'trg_sync_shipment_status')
         || '/' || (select count(*)::text from pg_trigger
                     where tgname = 'trg_sync_so_status_down' and tgfoid = 'vessl.sync_so_status_down()'::regprocedure)
         || '/' || (select case when pg_get_triggerdef(oid) = (select def_down from _pre146) then 'same' else 'changed' end
                      from pg_trigger where tgname = 'trg_sync_so_status_down'),
         '0/1/same'::text
  union all
  select 'b2 new body -- exactly as written here (SO to PO only), security definer',
         (select md5(prosrc) || '/' || length(prosrc) || '/' || prosecdef::text
            from pg_proc where oid = 'vessl.sync_so_status_down()'::regprocedure),
         'b89dbb84c925b78948687dcd7596fd1f/1168/true'::text
  union all
  select 'b3 the old bodies kept, attached to nothing',
         (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.sync_so_status_down_pre146()'::regprocedure)
         || ' ' || (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.sync_shipment_status()'::regprocedure)
         || ' ' || (select count(*)::text from pg_trigger
                     where tgfoid in ('vessl.sync_so_status_down_pre146()'::regprocedure, 'vessl.sync_shipment_status()'::regprocedure)),
         'd20e88485af499d009533b83aded4bff/2252 ab3b5f4d7a49921153e67937a1c851eb/1682 0'::text
  union all
  select 'b4 the rest of the SO and PO sync exactly as before',
         (select case when string_agg(p.proname || ' ' || md5(p.prosrc), ', ' order by p.proname) = (select h_others from _pre146)
                      then 'same' else 'changed' end
            from pg_proc p where p.pronamespace = 'vessl'::regnamespace
             and p.proname in ('sync_so_to_po', 'sync_po_to_so', 'sync_status_on_link', 'notify_portal_on_so_status', 'record_order_history'))
         || '/' || (select string_agg(c.relname || ' ' || t.tgname, ', ' order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relnamespace = 'vessl'::regnamespace and not t.tgisinternal
                       and c.relname in ('shipments', 'purchase_orders', 'sales_orders', 'shipment_pos', 'sales_order_pos')),
         'same/purchase_orders trg_order_history, purchase_orders trg_sync_po_to_so, sales_order_pos trg_sync_status_on_link, sales_orders trg_notify_portal_on_so_status, sales_orders trg_order_history, sales_orders trg_sync_so_status_down, sales_orders trg_sync_so_to_po, shipments trg_order_history'::text
  union all
  select 'b5 probes -- shipment leaves orders alone, SO leaves shipments alone, SO and PO still sync',
         (select string_agg(result, ' || ' order by step) from _probe146),
         'PO shipped SO shipped || ship in_transit no arrival PO delivered || ship at_destination_port PO shipped || SO delivered ship in_transit || ship in_transit no arrival PO invoiced'::text
  union all
  select 'b6 no row changed anywhere, no notification, no history',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_ships from _pre146) then 'same' else 'changed' end from vessl.shipments s)
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) = (select h_pos from _pre146) then 'same' else 'changed' end from vessl.purchase_orders p)
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(o)::text, '/' order by o.id), '')) = (select h_sos from _pre146) then 'same' else 'changed' end from vessl.sales_orders o)
         || '/' || ((select count(*) from portal.notifications) - (select n_notif from _pre146))::text
         || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre146))::text,
         'same/same/same/0/0'::text
  union all
  select 'z0 verification ran, SO trigger now on ' || (select p.proname || ' md5 ' || md5(p.prosrc) || '/' || length(p.prosrc)
                                                         from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname = 'trg_sync_so_status_down'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
