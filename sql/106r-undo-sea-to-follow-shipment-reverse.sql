-- 106r -- Reverse 106. Puts back the shipment, its link and the PO updated_at
-- exactly as 106 found them.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 106. One transaction.
--
-- WHAT IT DOES
--   1 inserts shipment 5a1623db again with the same id, number, status, client
--     and created and updated times (18.44.42.737884 UTC), every other column null
--   2 inserts the one link row between it and PO 2dd16452
--   3 sets the PO updated_at back to 18.57.08.673 UTC, the value 106 found.
--     The status column is not written; the PO stays draft.
-- The shipments table fires its trigger on UPDATE OF status only, so the insert
-- moves no PO or sales order.
--
-- GUARDS. The shipment id is free, the PO has no shipment link, and the PO is
-- draft with updated_at 17.16.33.359, as 106 left it.
--
-- CHECKS. b2 and b3 compare whole rows by md5 against hashes measured before 106,
-- so a pass means the shipment row and the PO row are byte for byte as they were.
--   shipment row before 106   1d912105ab5551a69e2bc1adcecf109a
--   PO row before 106         b338f4221127bac9eeda0d133b7786d5
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _k106r (ship_id uuid, po_id uuid) on commit drop;
insert into _k106r values ('5a1623db-ce30-4f3a-90d7-e8b7bbb90136'::uuid, '2dd16452-b1d0-4367-9022-e2cec9b36598'::uuid);

create temp table _pre106r on commit drop as
  select
    (select count(*) from vessl.shipments s, _k106r k where s.id = k.ship_id)                          as n_ship,
    (select count(*) from vessl.shipment_pos sp, _k106r k where sp.purchase_order_id = k.po_id)        as n_po_links,
    (select count(*) from vessl.purchase_orders p, _k106r k
      where p.id = k.po_id and p.status::text = 'draft'
        and p.updated_at = make_timestamptz(2026,10,2,17,16,33.359,'UTC'))                             as n_po_ok;

do $guard$
begin
  if (select n_ship from _pre106r) <> 0 then
    raise exception 'shipment 5a1623db already exists, nothing changed';
  end if;
  if (select n_po_links from _pre106r) <> 0 then
    raise exception 'the PO already has a shipment link, nothing changed';
  end if;
  if (select n_po_ok from _pre106r) <> 1 then
    raise exception 'the PO is not draft at 17.16.33.359 as 106 left it, nothing changed';
  end if;
end
$guard$;

create temp table _done106r (step int, n int) on commit drop;

do $redo$
declare
  n integer;
begin
  insert into vessl.shipments (id, shipment_number, status, client_company_id, created_at, updated_at)
  select k.ship_id, 'SEA-To FOllow', 'in_transit'::vessl.container_status,
         '733c76c1-9433-4d6a-8eff-4c54d20548ac'::uuid,
         make_timestamptz(2026,10,2,18,44,42.737884,'UTC'), make_timestamptz(2026,10,2,18,44,42.737884,'UTC')
    from _k106r k;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 1 inserted % shipments, not 1, nothing changed', n; end if;
  insert into _done106r values (1, n);

  insert into vessl.shipment_pos (shipment_id, purchase_order_id)
  select k.ship_id, k.po_id from _k106r k;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 2 inserted % links, not 1, nothing changed', n; end if;
  insert into _done106r values (2, n);

  update vessl.purchase_orders p
     set updated_at = make_timestamptz(2026,10,2,18,57,8.673,'UTC')
    from _k106r k
   where p.id = k.po_id
     and p.status::text = 'draft'
     and p.updated_at = make_timestamptz(2026,10,2,17,16,33.359,'UTC');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'step 3 changed % PO rows, not 1, nothing changed', n; end if;
  insert into _done106r values (3, n);
end
$redo$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 guards -- shipment id free, PO has no link, PO draft at 17.16.33.359' as chk,
         (select n_ship::text || '/' || n_po_links::text || '/' || n_po_ok::text from _pre106r) as got,
         '0/0/1' as want
  union all
  select 'b1 one row changed at each step',
         (select string_agg(n::text, '/' order by step) from _done106r),
         '1/1/1'
  union all
  select 'b2 the shipment row is byte for byte the one 106 deleted, and linked to the PO again',
         (select md5(to_jsonb(s)::text) from vessl.shipments s, _k106r k where s.id = k.ship_id)
         || '/' || (select count(*)::text from vessl.shipment_pos sp, _k106r k
                     where sp.shipment_id = k.ship_id and sp.purchase_order_id = k.po_id),
         '1d912105ab5551a69e2bc1adcecf109a/1'
  union all
  select 'b3 the PO row is byte for byte as 106 found it',
         (select md5(to_jsonb(p)::text) from vessl.purchase_orders p, _k106r k where p.id = k.po_id),
         'b338f4221127bac9eeda0d133b7786d5'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
