-- 128 -- Sales orders and their purchase orders carry the same status (Kristy,
-- 20 Oct) -- the sync learns invoiced and testing, a new link lifts the sales
-- order to its PO, and the 27 linked pairs that disagree today are reconciled.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed (the functions
-- and the trigger) by 128r; the reconcile is recorded in order_history.
--
-- WHAT IT DOES.
--   1 vessl.status_rank(text), a new immutable helper -- the nine offered
--     statuses in order, with draft and received equal (a draft PO is a sales
--     order still received). sampling and sample_approved rank as confirmed,
--     ready_to_ship as in_production. cancelled has no rank (null), so nothing
--     ranks it against anything.
--   2 vessl.so_to_po_status maps testing to testing and invoiced to invoiced
--     (was nothing, and delivered). Everything else as before.
--   3 vessl.sync_so_status_down sends invoiced down as invoiced (was
--     delivered). delivered and closed still send delivered; the shipment half
--     is unchanged.
--   4 vessl.sync_status_on_link and trigger trg_sync_status_on_link, AFTER
--     INSERT on vessl.sales_order_pos. When a PO is linked to a sales order and
--     the PO is further along, the sales order moves up to po_to_so_status of
--     the PO. It NEVER moves the PO. It does nothing when either side is closed
--     or the PO is cancelled. Before this, linking moved nothing -- the gap that
--     left 29000/5440 at Received.
--   5 THE RECONCILE, 27 rows, each by id and the length of its number --
--       21 purchase orders delivered to invoiced, their sales orders already
--          invoiced (the old sync sent invoiced down as delivered);
--       6 sales orders up to their PO -- 1535890, 29000/5440 and VIP To FOllow
--          to in_production, 23-FBAF-2026, KUI-SO-2026-011 and KUI-SO-2026-012
--          to delivered.
--     vessl.change_note labels every order_history row it writes. For the six
--     sales orders, trg_notify_portal_on_so_status (a client portal notice) and
--     trg_sync_so_status_down (it would stamp linked shipments delivered with
--     today as their arrival) are disabled around the update and enabled again
--     before the verification -- b9 confirms both are on.
--   Left alone, as decided -- the two draft POs against received sales orders
--   (KUI-SO-2026-013 with KUI-PO-2026-001, 2725 with 2725), which rank equal,
--   and PO 11990 9 (draft) under the shipped 119909, which needs a person.
--
-- GUARDS, before any change.
--   status_rank and sync_status_on_link do not exist yet
--   so_to_po_status and sync_so_status_down read as measured on 19 Oct
--   all 27 rows still have the id, number length and status measured on 20 Oct,
--   and each still has its partner in the status measured
--
-- PROBES, each undone, with throwaway ZZ-128-PROBE orders made as postgres.
--   p1 SO received, PO in_production, linked -- the SO becomes in_production.
--   p2 SO shipped, PO draft, linked -- neither moves (the PO is never moved).
--   p3 SO received, PO closed, linked -- neither moves (closed is skipped).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 128 reconcile -- Kristy, SO and PO statuses must match';

create temp table _plan128 (tbl text, id uuid, len int, from_status text, to_status text, partner uuid, partner_status text) on commit drop;
insert into _plan128 values
  ('po', 'b6c40ec6-4f7a-4aa7-a8de-c1af50d4a528', 12, 'delivered', 'invoiced', '8f114cf5-ad46-417d-8054-a7356c36ae85', 'invoiced'),
  ('po', 'a5cb44a0-bfdb-4cce-9545-db2b0651051c', 12, 'delivered', 'invoiced', '34ebc13b-b4e3-4602-b305-ca9e2bc8df4e', 'invoiced'),
  ('po', '0a82cc3b-d9d4-49bf-b72e-575f6a81aa01', 12, 'delivered', 'invoiced', '30ce7ba2-f243-4460-98ef-24942172bf56', 'invoiced'),
  ('po', 'c24d8fad-e13e-47fa-877f-7a7563c9b44d', 12, 'delivered', 'invoiced', '0b172e66-788d-4262-b81b-e092743b4fa3', 'invoiced'),
  ('po', '36c18578-fc3c-435c-81a6-b0a0ed1f9604', 13, 'delivered', 'invoiced', 'd22e2e56-68b9-4395-b18b-7aab13e807fb', 'invoiced'),
  ('po', '790b67c2-ed83-461f-a4ef-bb9b73ee3c9c', 13, 'delivered', 'invoiced', 'fb6c6ae6-ecb1-4f51-a09a-188aa9509518', 'invoiced'),
  ('po', '675ab96c-abb2-423b-9cff-19cbc5b4f3f8',  6, 'delivered', 'invoiced', '85c790af-dd95-4451-adff-d28d586ba2bc', 'invoiced'),
  ('po', '3d42c099-ff21-4301-9922-782e7560fbca', 13, 'delivered', 'invoiced', 'b36e5801-f734-4061-901b-e42f4579d245', 'invoiced'),
  ('po', '7efceabd-36bb-46b4-83f6-cb3e0612b7cb', 13, 'delivered', 'invoiced', 'c9242bab-0eb6-4b67-8d29-2e4642529c31', 'invoiced'),
  ('po', '50466e83-4754-4eb4-9f81-fd8d4904027e', 13, 'delivered', 'invoiced', 'eb3f3a2a-dadc-4942-bf22-b85dd801accd', 'invoiced'),
  ('po', '97454d53-db83-48e2-9da9-c1ece2ff6c59', 13, 'delivered', 'invoiced', '579c9a5e-819f-4e7f-99e6-af92c9895feb', 'invoiced'),
  ('po', 'f482d8e0-2eac-4f3f-8005-03c18fbc1737', 13, 'delivered', 'invoiced', '917cc36c-c781-46c4-99a9-2df060d29f3d', 'invoiced'),
  ('po', '8dfd814d-b059-495a-82bc-36e3c3809135', 13, 'delivered', 'invoiced', 'f71b63ca-b7e3-4038-87ab-2974ab352621', 'invoiced'),
  ('po', '2265b2e4-39ee-4de8-ad88-42d45bbc6f24', 13, 'delivered', 'invoiced', '3e1a4ebf-309a-4e12-a43a-a75631f3df1b', 'invoiced'),
  ('po', '9cd1da36-f825-495a-ba20-2f4280c3bca2', 21, 'delivered', 'invoiced', '3d2b81be-b258-46c3-974a-be9a09e5babe', 'invoiced'),
  ('po', '3c02a9c2-6d05-4f16-9f55-426a17ca1764', 10, 'delivered', 'invoiced', '80221fad-f5e5-4805-9c1d-c736aa386344', 'invoiced'),
  ('po', '88515dac-4a6c-4fe8-88e0-3b1b3758d24d', 10, 'delivered', 'invoiced', '8967b670-b987-48fb-b18e-7456dbacef2b', 'invoiced'),
  ('po', 'b477adc4-7c96-4fce-9c8d-bb195483cde4',  6, 'delivered', 'invoiced', 'ad1ca5c5-e6cd-498b-a37a-96ee59429a78', 'invoiced'),
  ('po', '49fd4603-2dd7-4429-93df-77950fed86c4',  6, 'delivered', 'invoiced', 'a20dcf18-e841-45e7-86cb-5f91c62405ab', 'invoiced'),
  ('po', '7fdbe1dc-9fef-492f-bc6d-379b6e769bf1',  6, 'delivered', 'invoiced', '31a42016-0307-480e-af5c-51a8c16d9fb3', 'invoiced'),
  ('po', '74626874-146e-4d75-a18c-5b424755d75f',  4, 'delivered', 'invoiced', '94f70a78-16a4-43f1-9a98-1aace9305a5d', 'invoiced'),
  ('so', '5fc47f34-7b89-428a-b49b-768622981fc4',  7, 'received', 'in_production', '1a281b0e-9a80-4e5d-9fe5-909aa8233f6f', 'in_production'),
  ('so', 'e7ca631d-e9f8-4bd4-b27e-d81fda3332fa', 12, 'received', 'delivered',     '56c3ced8-94d6-4156-a4d1-1501781238f8', 'delivered'),
  ('so', 'febd0d6a-122e-461b-a859-b1f76b3d6ed4', 15, 'received', 'delivered',     'b0c2ea32-31b3-4588-9b5f-64e64d233b70', 'delivered'),
  ('so', '5539470a-2f4b-4c42-824a-84bdc59ab85c', 15, 'received', 'delivered',     'ac6f1c92-17ba-41a2-ba88-3624c816d614', 'delivered'),
  ('so', '66dea7cd-57a1-46eb-9702-f12367be5423', 10, 'received', 'in_production', '13d86d4a-d8c3-4ff6-9f5b-5ef21b7c378e', 'in_production'),
  ('so', 'c0ce4323-261a-4bfe-b83e-615d5d51b751', 13, 'testing',  'in_production', 'a448008d-1fb5-435f-8727-29b49ce56bd3', 'in_production');

create temp table _pre128 on commit drop as
  select
    (select count(*) from _plan128)                                                               as n_plan,
    -- Each PO row -- its id, its number length, its status, and its linked SO in the status measured.
    (select count(*) from _plan128 p
       join vessl.purchase_orders po on po.id = p.id and length(po.order_number) = p.len and po.status::text = p.from_status
       join vessl.sales_order_pos sop on sop.purchase_order_id = po.id and sop.sales_order_id = p.partner
       join vessl.sales_orders s on s.id = p.partner and s.status = p.partner_status
      where p.tbl = 'po')
    + (select count(*) from _plan128 p
       join vessl.sales_orders s on s.id = p.id and length(s.so_number) = p.len and s.status = p.from_status
       join vessl.sales_order_pos sop on sop.sales_order_id = s.id and sop.purchase_order_id = p.partner
       join vessl.purchase_orders po on po.id = p.partner and po.status::text = p.partner_status
      where p.tbl = 'so')                                                                          as n_match,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname in ('status_rank', 'sync_status_on_link'))           as n_new_fn,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'so_to_po_status'
        and p.prosrc like '%when ''invoiced'' then ''delivered''%')                               as so_fn_old,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'sync_so_status_down'
        and p.prosrc like '%in (''delivered'',''invoiced'',''closed'') then ''delivered''%in (''delivered'',''invoiced'',''closed'') then ''delivered''%') as down_fn_old,
    (select count(*) from vessl.purchase_orders)                                                  as n_pos,
    (select count(*) from vessl.sales_orders)                                                     as n_sos,
    (select count(*) from portal.notifications)                                                   as n_notices,
    (select count(*) from vessl.order_history)                                                    as n_hist,
    -- Every PO and SO status outside the plan, and every shipment, so b7 and b8 can prove none moved.
    (select md5(coalesce(string_agg(po.id::text || '=' || po.status::text, '/' order by po.id), ''))
       from vessl.purchase_orders po where po.id not in (select id from _plan128))                as h_pos,
    (select md5(coalesce(string_agg(s.id::text || '=' || s.status, '/' order by s.id), ''))
       from vessl.sales_orders s where s.id not in (select id from _plan128))                     as h_sos,
    (select md5(coalesce(string_agg(to_jsonb(sh)::text, '/' order by sh.id), ''))
       from vessl.shipments sh)                                                                   as h_ships;

do $guard$
begin
  if (select n_plan from _pre128) <> 27 then
    raise exception 'the plan does not hold 27 rows, nothing changed';
  end if;
  if (select n_match from _pre128) <> 27 then
    raise exception 'not all 27 rows and their partners read as measured on 20 Oct, nothing changed';
  end if;
  if (select n_new_fn from _pre128) <> 0 then
    raise exception 'status_rank or sync_status_on_link already exists, so 128 has run before, nothing changed';
  end if;
  if (select so_fn_old from _pre128) <> 1 or (select down_fn_old from _pre128) <> 1 then
    raise exception 'so_to_po_status or sync_so_status_down no longer reads as measured on 19 Oct, nothing changed';
  end if;
end
$guard$;

-- 1. The rank.
create function vessl.status_rank(s text)
 returns integer
 language sql
 immutable
as $function$
  select case s
    when 'draft' then 1 when 'received' then 1
    when 'confirmed' then 2 when 'sampling' then 2 when 'sample_approved' then 2
    when 'testing' then 3
    when 'in_production' then 4 when 'ready_to_ship' then 4
    when 'shipped' then 5 when 'delivered' then 6 when 'invoiced' then 7 when 'closed' then 8
    else null end
$function$;
comment on function vessl.status_rank(text) is
  'Script 128. Where an order status sits, for comparing a sales order with its PO. draft and received rank equal; cancelled has no rank.';

-- 2. so_to_po_status -- testing and invoiced one to one.
create or replace function vessl.so_to_po_status(so text)
 returns text
 language sql
 immutable
as $function$
  select case so
    when 'confirmed' then 'confirmed' when 'testing' then 'testing'
    when 'in_production' then 'in_production'
    when 'shipped' then 'shipped' when 'delivered' then 'delivered'
    when 'invoiced' then 'invoiced' when 'closed' then 'closed'
    else null end
$function$;

-- 3. sync_so_status_down -- invoiced sent down as invoiced.
create or replace function vessl.sync_so_status_down()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  po_target text; ship_target text; po_type text; sh_type text;
begin
  if pg_trigger_depth() > 1 then return NEW; end if;
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  po_target := case
    when NEW.status::text in ('delivered','closed') then 'delivered'
    when NEW.status::text = 'invoiced' then 'invoiced'
    when NEW.status::text = 'shipped'       then 'shipped'
    when NEW.status::text = 'in_production' then 'in_production'
    when NEW.status::text = 'testing'       then 'testing'
    when NEW.status::text = 'confirmed'     then 'confirmed'
    else null end;

  ship_target := case
    when NEW.status::text in ('delivered','invoiced','closed') then 'delivered'
    when NEW.status::text = 'shipped' then 'in_transit'
    else null end;

  select format_type(a.atttypid, a.atttypmod) into po_type
    from pg_attribute a where a.attrelid = 'vessl.purchase_orders'::regclass and a.attname = 'status';
  select format_type(a.atttypid, a.atttypmod) into sh_type
    from pg_attribute a where a.attrelid = 'vessl.shipments'::regclass and a.attname = 'status';

  if po_target is not null and vessl.label_ok(po_type, po_target) then
    execute format(
      'update vessl.purchase_orders po set status = %L::%s
         from vessl.sales_order_pos sop
        where sop.sales_order_id = %L and sop.purchase_order_id = po.id
          and po.status::text not in (''closed'',''cancelled'')
          and po.status::text <> %L', po_target, po_type, NEW.id, po_target);
  end if;

  if ship_target is not null and vessl.label_ok(sh_type, ship_target) then
    execute format(
      'update vessl.shipments s
          set status = %L::%s,
              actual_arrival = case when %L = ''delivered'' and s.actual_arrival is null
                                    then now() else s.actual_arrival end
         from vessl.sales_order_pos sop
         join vessl.shipment_pos sp on sp.purchase_order_id = sop.purchase_order_id
        where sop.sales_order_id = %L and sp.shipment_id = s.id
          and s.status::text <> ''cancelled''
          and s.status::text <> %L', ship_target, sh_type, ship_target, NEW.id, ship_target);
  end if;

  return NEW;
end $function$;

-- 4. A new link lifts the sales order to its PO, never the other way.
create function vessl.sync_status_on_link()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  so_st text; po_st text;
begin
  if pg_trigger_depth() > 1 then return NEW; end if;
  select s.status into so_st from vessl.sales_orders s where s.id = NEW.sales_order_id;
  select p.status::text into po_st from vessl.purchase_orders p where p.id = NEW.purchase_order_id;
  if so_st is null or po_st is null then return NEW; end if;
  if so_st = 'closed' or po_st in ('closed', 'cancelled') then return NEW; end if;
  if vessl.status_rank(po_st) > vessl.status_rank(so_st) then
    update vessl.sales_orders
       set status = vessl.po_to_so_status(po_st), updated_at = now()
     where id = NEW.sales_order_id;
  end if;
  return NEW;
end $function$;
comment on function vessl.sync_status_on_link() is
  'Script 128. When a PO is linked to a sales order and is further along, the sales order moves up to it. Never moves the PO; skips closed and cancelled.';
revoke all on function vessl.sync_status_on_link() from public;

create trigger trg_sync_status_on_link
  after insert on vessl.sales_order_pos
  for each row
  execute function vessl.sync_status_on_link();

-- 5. The reconcile. POs first; their sales orders already read invoiced, so
--    trg_sync_po_to_so finds nothing to change.
update vessl.purchase_orders po
   set status = p.to_status::vessl.order_status, updated_at = now()
  from _plan128 p
 where p.tbl = 'po' and po.id = p.id and length(po.order_number) = p.len and po.status::text = p.from_status;

alter table vessl.sales_orders disable trigger trg_notify_portal_on_so_status;
alter table vessl.sales_orders disable trigger trg_sync_so_status_down;

update vessl.sales_orders s
   set status = p.to_status, updated_at = now()
  from _plan128 p
 where p.tbl = 'so' and s.id = p.id and length(s.so_number) = p.len and s.status = p.from_status;

alter table vessl.sales_orders enable trigger trg_notify_portal_on_so_status;
alter table vessl.sales_orders enable trigger trg_sync_so_status_down;

create temp table _probe128 (step int, result text) on commit drop;

do $probe$
declare
  st text;
  res text;
  so uuid;
  po uuid;
begin
  -- p1 -- SO received, PO in_production -- the SO moves up.
  begin
    insert into vessl.sales_orders (so_number, status) values ('ZZ-128-PROBE', 'received') returning id into so;
    insert into vessl.purchase_orders (order_number, status) values ('ZZ-128-PROBE', 'in_production') returning id into po;
    insert into vessl.sales_order_pos (sales_order_id, purchase_order_id) values (so, po);
    select s.status || '/' || p.status::text into res
      from vessl.sales_orders s, vessl.purchase_orders p where s.id = so and p.id = po;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe128 values (1, case when st = 'P0001' then res else st end);
  end;

  -- p2 -- SO shipped, PO draft -- neither moves.
  begin
    insert into vessl.sales_orders (so_number, status) values ('ZZ-128-PROBE', 'shipped') returning id into so;
    insert into vessl.purchase_orders (order_number, status) values ('ZZ-128-PROBE', 'draft') returning id into po;
    insert into vessl.sales_order_pos (sales_order_id, purchase_order_id) values (so, po);
    select s.status || '/' || p.status::text into res
      from vessl.sales_orders s, vessl.purchase_orders p where s.id = so and p.id = po;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe128 values (2, case when st = 'P0001' then res else st end);
  end;

  -- p3 -- SO received, PO closed -- closed is skipped.
  begin
    insert into vessl.sales_orders (so_number, status) values ('ZZ-128-PROBE', 'received') returning id into so;
    insert into vessl.purchase_orders (order_number, status) values ('ZZ-128-PROBE', 'closed') returning id into po;
    insert into vessl.sales_order_pos (sales_order_id, purchase_order_id) values (so, po);
    select s.status || '/' || p.status::text into res
      from vessl.sales_orders s, vessl.purchase_orders p where s.id = so and p.id = po;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe128 values (3, case when st = 'P0001' then res else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, rows to reconcile = ' || (select n_match::text from _pre128)
           || ', purchase orders = ' || (select n_pos::text from _pre128)
           || ', sales orders = ' || (select n_sos::text from _pre128) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 status_rank in order, draft equal to received, cancelled unranked',
         (vessl.status_rank('draft') || ',' || vessl.status_rank('received') || ',' || vessl.status_rank('confirmed') || ','
          || vessl.status_rank('testing') || ',' || vessl.status_rank('in_production') || ',' || vessl.status_rank('shipped') || ','
          || vessl.status_rank('delivered') || ',' || vessl.status_rank('invoiced') || ',' || vessl.status_rank('closed') || ','
          || coalesce(vessl.status_rank('cancelled')::text, 'null'))::text,
         '1,1,2,3,4,5,6,7,8,null'::text
  union all
  select 'b2 so_to_po_status maps testing and invoiced one to one; received still nothing',
         (vessl.so_to_po_status('testing') || '/' || vessl.so_to_po_status('invoiced') || '/'
          || coalesce(vessl.so_to_po_status('received'), 'null') || '/' || vessl.so_to_po_status('delivered') || '/'
          || vessl.so_to_po_status('closed'))::text,
         'testing/invoiced/null/delivered/closed'::text
  union all
  select 'b3 sync_so_status_down sends invoiced down as invoiced, shipments as before',
         (select (p.prosrc like '%= ''invoiced'' then ''invoiced''%')::text || '/'
                 || (p.prosrc like '%in (''delivered'',''closed'') then ''delivered''%')::text || '/'
                 || (p.prosrc like '%in (''delivered'',''invoiced'',''closed'') then ''delivered''%then ''in_transit''%')::text || '/'
                 || p.prosecdef::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'sync_so_status_down'),
         'true/true/true/true'::text
  union all
  select 'b4 the link trigger, after insert on sales_order_pos, enabled',
         (select count(*)::text || '/' || coalesce(string_agg(t.tgenabled::text, ''), 'none') from pg_trigger t
           where t.tgrelid = 'vessl.sales_order_pos'::regclass and t.tgname = 'trg_sync_status_on_link'),
         '1/O'::text
  union all
  select 'b5 the 27 rows now read their new status',
         ((select count(*) from _plan128 p join vessl.purchase_orders po on po.id = p.id and po.status::text = p.to_status where p.tbl = 'po')
          + (select count(*) from _plan128 p join vessl.sales_orders s on s.id = p.id and s.status = p.to_status where p.tbl = 'so'))::text,
         '27'::text
  union all
  select 'b6 linked pairs still differing -- the two drafts and 11990 9',
         (select count(*)::text from vessl.sales_order_pos sop
            join vessl.sales_orders s on s.id = sop.sales_order_id
            join vessl.purchase_orders po on po.id = sop.purchase_order_id
           where s.status <> po.status::text),
         '3'::text
  union all
  select 'b7 every other PO and SO status unchanged',
         (select case when md5(coalesce(string_agg(po.id::text || '=' || po.status::text, '/' order by po.id), ''))
                           = (select h_pos from _pre128) then 'same' else 'changed' end
            from vessl.purchase_orders po where po.id not in (select id from _plan128))
         || '/' ||
         (select case when md5(coalesce(string_agg(s.id::text || '=' || s.status, '/' order by s.id), ''))
                           = (select h_sos from _pre128) then 'same' else 'changed' end
            from vessl.sales_orders s where s.id not in (select id from _plan128)),
         'same/same'::text
  union all
  select 'b8 no shipment touched, no client portal notice posted',
         (select case when md5(coalesce(string_agg(to_jsonb(sh)::text, '/' order by sh.id), ''))
                           = (select h_ships from _pre128) then 'same' else 'changed' end
            from vessl.shipments sh)
         || '/' || ((select count(*) from portal.notifications) - (select n_notices from _pre128))::text,
         'same/0'::text
  union all
  select 'b9 the portal notice and the shipment sync are enabled again',
         (select string_agg(t.tgname || '=' || t.tgenabled::text, ' ' order by t.tgname) from pg_trigger t
           where t.tgrelid = 'vessl.sales_orders'::regclass
             and t.tgname in ('trg_notify_portal_on_so_status', 'trg_sync_so_status_down'))::text,
         'trg_notify_portal_on_so_status=O trg_sync_so_status_down=O'::text
  union all
  select 'b10 order_history has the 27 status changes, each with the change note',
         (select count(*)::text from vessl.order_history h
           where h.changed_at >= now() - interval '1 hour' and h.field = 'status'
             and h.note = 'script 128 reconcile -- Kristy, SO and PO statuses must match'
             and h.row_id in (select id from _plan128)),
         '27'::text
  union all
  select 'b11 same number of POs and SOs, probes left nothing',
         (select count(*)::text from vessl.purchase_orders) || ' / ' || (select count(*)::text from vessl.sales_orders),
         (select n_pos::text || ' / ' || n_sos::text from _pre128)
  union all
  select 'b12 probes -- SO lifted to its PO; a draft PO not pushed; closed skipped',
         (select string_agg(result, ' | ' order by step) from _probe128),
         'in_production/in_production | shipped/draft | received/closed'::text
  union all
  select 'z0 verification ran, linked pairs differing = '
           || (select count(*)::text from vessl.sales_order_pos sop
                 join vessl.sales_orders s on s.id = sop.sales_order_id
                 join vessl.purchase_orders po on po.id = sop.purchase_order_id
                where s.status <> po.status::text),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
