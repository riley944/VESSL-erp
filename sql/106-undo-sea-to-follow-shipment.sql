-- 106 -- Undo the accidental Generate shipment on PO SEA-To FOllow (Seafarer/SeaGull).
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 106r.
--
-- WHAT THE CLICK DID, on 2 Oct 2026 at 18.44 UTC
--   created shipment 5a1623db, number SEA-To FOllow (13 characters), status
--     in_transit, client Seafarer/SeaGull, every logistics field empty
--   created the one shipment_pos row linking it to PO 2dd16452
--   set the PO status to shipped and its updated_at to 18.44.44.067
-- No sales order is linked to this PO, so no sales order moved and the client
-- portal got no notification. Nothing was emailed.
--
-- WHAT HAPPENED SINCE. At 18.57.08.673 UTC the PO status was set back to draft
-- from a status control (its line items were not rewritten, so not the edit
-- form). The shipment and its link are still there. So this script finds the PO
-- already at draft and has only its updated_at to put back.
--
-- WHAT IT DOES, by id only
--   1 deletes the one link row (shipment 5a1623db, PO 2dd16452)
--   2 deletes shipment 5a1623db
--   3 sets the PO updated_at back to 17.16.33.359 UTC, the time of the last
--     real edit, measured before the click. The status column is not written,
--     so trg_sync_po_to_so does not fire. The status stays draft.
--
-- GUARDS, before any change. Nothing changes unless every one holds.
--   the shipment exists by id, created 18.44.42.737884, never updated, 13
--     character number, in_transit, this client, all sixteen logistics columns null
--   exactly one link names it, and it is the link to this PO, the only one the PO has
--   no container, tracking event or freight invoice points at it
--   the PO is draft with updated_at 18.57.08.673
--   the PO is linked to no sales order
-- and after each step, exactly one row changed.
--
-- PROBE. Step 3 is tried first in a sub-block and undone, to show that writing
-- updated_at alone moves no sales order and adds no portal notification.
--
-- NO EMAIL. None of these tables has a mailing trigger.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a, b or p row is a failed check.

begin;

create temp table _k106 (ship_id uuid, po_id uuid) on commit drop;
insert into _k106 values ('5a1623db-ce30-4f3a-90d7-e8b7bbb90136'::uuid, '2dd16452-b1d0-4367-9022-e2cec9b36598'::uuid);

create temp table _pre106 on commit drop as
  select
    (select count(*) from vessl.shipments s, _k106 k
      where s.id = k.ship_id
        and s.created_at = make_timestamptz(2026,10,2,18,44,42.737884,'UTC')
        and s.updated_at = s.created_at
        and length(s.shipment_number) = 13
        and s.status::text = 'in_transit'
        and s.client_company_id = '733c76c1-9433-4d6a-8eff-4c54d20548ac'::uuid
        and num_nonnulls(s.booking_number, s.bill_of_lading, s.origin_port_id, s.destination_port_id,
                         s.carrier_company_id, s.freight_forwarder_company_id, s.vessel_id, s.voyage_code,
                         s.estimated_departure, s.estimated_arrival, s.actual_departure, s.actual_arrival,
                         s.inco_term, s.vessel_name, s.container_no, s.voyage_no) = 0)                  as n_ship_ok,
    (select count(*) from vessl.shipment_pos sp, _k106 k
      where sp.shipment_id = k.ship_id and sp.purchase_order_id = k.po_id)                            as n_the_link,
    (select count(*) from vessl.shipment_pos sp, _k106 k where sp.shipment_id = k.ship_id)             as n_ship_links,
    (select count(*) from vessl.shipment_pos sp, _k106 k where sp.purchase_order_id = k.po_id)         as n_po_links,
    (select count(*) from vessl.containers c, _k106 k where c.shipment_id = k.ship_id)
      + (select count(*) from vessl.tracking_events t, _k106 k where t.shipment_id = k.ship_id)
      + (select count(*) from vessl.freight_invoices f, _k106 k where f.shipment_id = k.ship_id)        as n_dependents,
    (select count(*) from vessl.purchase_orders p, _k106 k
      where p.id = k.po_id and p.status::text = 'draft'
        and p.updated_at = make_timestamptz(2026,10,2,18,57,8.673,'UTC'))                              as n_po_ok,
    (select count(*) from vessl.sales_order_pos sop, _k106 k where sop.purchase_order_id = k.po_id)     as n_so_links,
    (select md5((to_jsonb(p) - 'updated_at')::text) from vessl.purchase_orders p, _k106 k
      where p.id = k.po_id)                                                                             as h_po_rest,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), ''))
       from vessl.purchase_orders p where p.id <> (select po_id from _k106))                           as h_other_pos,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.shipments s where s.id <> (select ship_id from _k106))                               as h_other_ships,
    (select md5(coalesce(string_agg(sp.shipment_id::text || '/' || sp.purchase_order_id::text, ','
                 order by sp.shipment_id, sp.purchase_order_id), ''))
       from vessl.shipment_pos sp where sp.shipment_id <> (select ship_id from _k106))                 as h_other_links,
    (select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), ''))
       from vessl.sales_orders so)                                                                      as h_so,
    (select count(*) from portal.notifications)                                                         as n_notif,
    (select count(*) from vessl.shipments)                                                              as n_ships,
    (select count(*) from vessl.shipment_pos)                                                           as n_links;

do $guard$
begin
  if (select n_ship_ok from _pre106) <> 1 then
    raise exception 'shipment 5a1623db is missing or no longer as the click left it, nothing changed';
  end if;
  if (select n_the_link from _pre106) <> 1 or (select n_ship_links from _pre106) <> 1
     or (select n_po_links from _pre106) <> 1 then
    raise exception 'the shipment and PO no longer have exactly the one link between them, nothing changed';
  end if;
  if (select n_dependents from _pre106) <> 0 then
    raise exception 'a container, tracking event or freight invoice now points at the shipment, nothing changed';
  end if;
  if (select n_po_ok from _pre106) <> 1 then
    raise exception 'the PO is no longer draft at 18.57.08.673, so it was touched again, nothing changed';
  end if;
  if (select n_so_links from _pre106) <> 0 then
    raise exception 'the PO is now linked to a sales order, nothing changed';
  end if;
end
$guard$;

create temp table _probe106 (n int, quiet boolean) on commit drop;

do $probe$
declare
  n integer;
  quiet boolean;
begin
  begin
    update vessl.purchase_orders p
       set updated_at = make_timestamptz(2026,10,2,17,16,33.359,'UTC')
      from _k106 k
     where p.id = k.po_id;
    get diagnostics n = row_count;
    quiet := (select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), '')) from vessl.sales_orders so)
               = (select h_so from _pre106)
         and (select count(*) from portal.notifications) = (select n_notif from _pre106);
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe106 values (n, quiet);
  end;
end
$probe$;

create temp table _done106 (step int, n int) on commit drop;

do $undo$
declare
  n integer;
begin
  delete from vessl.shipment_pos sp
   using _k106 k
   where sp.shipment_id = k.ship_id and sp.purchase_order_id = k.po_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 1 deleted % link rows, not 1, nothing changed', n; end if;
  insert into _done106 values (1, n);

  delete from vessl.shipments s
   using _k106 k
   where s.id = k.ship_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 2 deleted % shipments, not 1, nothing changed', n; end if;
  insert into _done106 values (2, n);

  update vessl.purchase_orders p
     set updated_at = make_timestamptz(2026,10,2,17,16,33.359,'UTC')
    from _k106 k
   where p.id = k.po_id
     and p.status::text = 'draft'
     and p.updated_at = make_timestamptz(2026,10,2,18,57,8.673,'UTC');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 3 changed % PO rows, not 1, nothing changed', n; end if;
  insert into _done106 values (3, n);
end
$undo$;

-- VERIFICATION. z0 alone is a pass. Any a, b or p row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 guards -- shipment as created, the one link both ways, no dependents, PO draft at 18.57, no sales order' as chk,
         (select n_ship_ok::text || '/' || n_the_link::text || '/' || n_ship_links::text || '/' || n_po_links::text
                 || '/' || n_dependents::text || '/' || n_po_ok::text || '/' || n_so_links::text from _pre106) as got,
         '1/1/1/1/0/1/0' as want
  union all
  select 'p1 probe -- updated_at alone changed one row and moved no sales order or portal notification',
         (select n::text || '/' || quiet::text from _probe106),
         '1/true'
  union all
  select 'b1 one row changed at each step',
         (select string_agg(n::text, '/' order by step) from _done106),
         '1/1/1'
  union all
  select 'b2 the shipment and its link are gone',
         (select count(*)::text from vessl.shipments s, _k106 k where s.id = k.ship_id)
         || '/' || (select count(*)::text from vessl.shipment_pos sp, _k106 k
                     where sp.shipment_id = k.ship_id or sp.purchase_order_id = k.po_id),
         '0/0'
  union all
  select 'b3 the PO is draft with updated_at back at 17.16.33.359',
         (select p.status::text || '/' || (p.updated_at = make_timestamptz(2026,10,2,17,16,33.359,'UTC'))::text
            from vessl.purchase_orders p, _k106 k where p.id = k.po_id),
         'draft/true'
  union all
  select 'b4 every other column of the PO unchanged',
         (select (md5((to_jsonb(p) - 'updated_at')::text) = x.h_po_rest)::text
            from vessl.purchase_orders p, _k106 k, _pre106 x where p.id = k.po_id),
         'true'
  union all
  select 'b5 every other PO, shipment and link unchanged, and one fewer shipment and link',
         (select ((select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), ''))
                     from vessl.purchase_orders p where p.id <> (select po_id from _k106)) = x.h_other_pos)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                     from vessl.shipments s) = x.h_other_ships)::text
                 || '/' || ((select md5(coalesce(string_agg(sp.shipment_id::text || '/' || sp.purchase_order_id::text, ','
                              order by sp.shipment_id, sp.purchase_order_id), ''))
                     from vessl.shipment_pos sp) = x.h_other_links)::text
                 || '/' || ((select count(*) from vessl.shipments) = x.n_ships - 1)::text
                 || '/' || ((select count(*) from vessl.shipment_pos) = x.n_links - 1)::text
            from _pre106 x),
         'true/true/true/true/true'
  union all
  select 'b6 sales orders unchanged and no portal notification added',
         (select ((select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), ''))
                     from vessl.sales_orders so) = x.h_so)::text
                 || '/' || ((select count(*) from portal.notifications) = x.n_notif)::text
            from _pre106 x),
         'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
