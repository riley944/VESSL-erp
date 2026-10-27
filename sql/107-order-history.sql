-- 107 -- Order history. Every change to the status and key dates of a purchase
-- order, sales order or shipment is recorded, whatever screen, button, trigger or
-- script made it. Reversed by 107r.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction.
--
-- WHAT IT CREATES
--   vessl.order_history, one row per changed field
--     table_name, row_id, order_ref (the order or shipment number at the time),
--     action (insert, update or delete), field, old_value, new_value, changed_at,
--     actor_id and actor_email (the signed-in app user, from the request JWT),
--     db_role and app_name (who it was when there is no app user, e.g. a script),
--     via (direct, or trigger when another trigger caused it), note (a label a
--     script can set with vessl.change_note)
--     No foreign keys, so history outlives a deleted order and cannot block a delete.
--     Row level security on; staff may read; nobody may insert, update or delete.
--   vessl.record_order_history(), one shared trigger function. SECURITY DEFINER
--     with a fixed search path, so it can write the table nobody else can. Every
--     error inside it is caught and turned into a warning in the Postgres log, so a
--     failed history insert can never fail the save it is recording.
--   trg_order_history on purchase_orders, sales_orders and shipments, after
--     insert, update and delete, for each row.
--
-- FIELDS RECORDED
--   purchase_orders   status, cargo_ready_date, requested_ship_date, cancel_date
--   sales_orders      status, cargo_ready_date, indc_date, cancel_date
--   shipments         status, estimated_departure, estimated_arrival
-- An update writes a row only for a field whose value changed, so the PO edit form
-- re-saving every field records nothing it did not change. An insert records each
-- of these fields that has a value; a delete records each one it had.
--
-- PROBES, each in a sub-block undone by raise exception, so none of them survives
-- even into the rehearsal. They touch no sales order status, so the portal
-- notification trigger never fires; no table they touch has a trigger that sends
-- email; and the only outbound path in the database (net, used by the portal
-- message and delivery request triggers) is untouched. b6 proves the portal
-- notifications and the outbound request queue are unchanged.
--   p1 a signed-in staff user moves PO SEA-To FOllow from draft to confirmed, as
--      the app would, role authenticated with the JWT claims of a real staff login
--      (Matt, auth user cd479d49). Row level security applies exactly as in the
--      app, so the PO is updated only because that identity is staff. That PO has
--      no sales order and no shipment.
--   p2 the PO edit form pattern, every field re-saved unchanged, records nothing
--   p3 a postgres script with a change note moves a date on SO 9579-00, a sales
--      order with no PO, by one day. Only the date column is written.
--   p4 a probe shipment is created, linked to SEA-To FOllow, set in_transit and
--      deleted. Its status sync moves the PO to shipped, recorded as via trigger.
--   p5 a probe PO and a probe SO are inserted and deleted, no client on either
--   p6 the history table is made to refuse every row; a PO date change still saves
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a, b or p row is a failed check.

begin;

create temp table _k107 (po_id uuid, so_id uuid, probe_ship uuid, probe_po uuid, probe_so uuid, probe_user uuid) on commit drop;
insert into _k107 values (
  '2dd16452-b1d0-4367-9022-e2cec9b36598'::uuid,
  'd50e3018-9b5e-4c91-8261-b0c56c87b338'::uuid,
  '00000000-0000-4000-8000-000000000107'::uuid,
  '00000000-0000-4000-8000-000000000207'::uuid,
  '00000000-0000-4000-8000-000000000307'::uuid,
  'cd479d49-0662-48f4-9958-f649b7fd8638'::uuid);

create temp table _pre107 on commit drop as
  select
    (select count(*) from pg_class c where c.relname = 'order_history' and c.relnamespace = 'vessl'::regnamespace) as n_table,
    (select count(*) from pg_proc p where p.proname = 'record_order_history')                                    as n_fn,
    (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname)
       from pg_trigger t
      where not t.tgisinternal
        and t.tgrelid in ('vessl.purchase_orders'::regclass, 'vessl.sales_orders'::regclass,
                          'vessl.shipments'::regclass, 'vessl.shipment_pos'::regclass))                          as triggers,
    (select count(*) from vessl.purchase_orders p, _k107 k where p.id = k.po_id and p.status::text = 'draft')      as n_po_draft,
    (select count(*) from vessl.sales_order_pos sop, _k107 k where sop.purchase_order_id = k.po_id)               as n_po_so,
    (select count(*) from vessl.shipment_pos sp, _k107 k where sp.purchase_order_id = k.po_id)                    as n_po_ship,
    (select count(*) from vessl.sales_orders so, _k107 k
      where so.id = k.so_id and so.cargo_ready_date = make_date(2026,12,3))                                       as n_so_ok,
    (select count(*) from vessl.sales_order_pos sop, _k107 k where sop.sales_order_id = k.so_id)                  as n_so_po,
    (select count(*) from vessl.shipments s, _k107 k where s.id = k.probe_ship)
      + (select count(*) from vessl.purchase_orders p, _k107 k where p.id = k.probe_po)
      + (select count(*) from vessl.sales_orders so, _k107 k where so.id = k.probe_so)                            as n_probe_ids,
    -- The p1 identity exists as a login with a 28 character email, the
    -- kinguniversal address the restrictive kui_staff_only rule requires.
    (select count(*) from auth.users u, _k107 k
      where u.id = k.probe_user and length(u.email) = 28
        and lower(u.email) like '%@kinguniversal.com')                                                            as n_staff_user,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.purchase_orders p)     as h_po,
    (select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), '')) from vessl.sales_orders so)     as h_so,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)           as h_ship,
    (select md5(coalesce(string_agg(sp.shipment_id::text || '/' || sp.purchase_order_id::text, ','
                 order by sp.shipment_id, sp.purchase_order_id), '')) from vessl.shipment_pos sp)                 as h_links,
    (select count(*) from portal.notifications)                                                                   as n_notif,
    (select count(*) from net.http_request_queue)                                                                 as n_http;

do $guard$
begin
  if (select n_table + n_fn from _pre107) <> 0 then
    raise exception 'order_history or record_order_history already exists, nothing changed';
  end if;
  if (select triggers from _pre107) is distinct from
     'vessl.purchase_orders.trg_sync_po_to_so,vessl.sales_orders.trg_notify_portal_on_so_status,vessl.sales_orders.trg_sync_so_status_down,vessl.sales_orders.trg_sync_so_to_po,vessl.shipments.trg_sync_shipment_status' then
    raise exception 'the triggers on these tables are not the five 107 was written against, nothing changed';
  end if;
  if (select n_po_draft from _pre107) <> 1 or (select n_po_so + n_po_ship from _pre107) <> 0 then
    raise exception 'PO SEA-To FOllow is not draft with no sales order and no shipment, so it is not safe to probe, nothing changed';
  end if;
  if (select n_so_ok from _pre107) <> 1 or (select n_so_po from _pre107) <> 0 then
    raise exception 'SO 9579-00 is not as measured, nothing changed';
  end if;
  if (select n_probe_ids from _pre107) <> 0 then
    raise exception 'a probe id is already taken, nothing changed';
  end if;
  if (select n_staff_user from _pre107) <> 1 then
    raise exception 'the staff login p1 uses is missing or changed, nothing changed';
  end if;
end
$guard$;

-- ── THE TABLE ──────────────────────────────────────────────────────────────
create table vessl.order_history (
  id          bigint generated always as identity primary key,
  table_name  text not null check (table_name in ('purchase_orders', 'sales_orders', 'shipments')),
  row_id      uuid not null,
  order_ref   text,
  action      text not null check (action in ('insert', 'update', 'delete')),
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  db_role     text,
  app_name    text,
  via         text not null check (via in ('direct', 'trigger')),
  note        text
);
create index order_history_row_idx on vessl.order_history (table_name, row_id, changed_at);
comment on table vessl.order_history is 'Status and key date changes on purchase orders, sales orders and shipments, written only by vessl.record_order_history (script 107).';

alter table vessl.order_history enable row level security;
revoke all on vessl.order_history from public, anon, authenticated, service_role;
grant select on vessl.order_history to authenticated;
create policy order_history_staff_read on vessl.order_history
  for select to authenticated using (vessl.is_staff());

-- ── THE FUNCTION ───────────────────────────────────────────────────────────
-- WHO. actor_id and actor_email come from the request JWT that the app sends with
-- every call, so a change made in the app names the person. A change caused by
-- another trigger runs inside the same request and names the same person, marked
-- via trigger. A script in the SQL editor has no JWT; it records db_role and
-- app_name, and the script can label itself with vessl.change_note.
create function vessl.record_order_history() returns trigger
  language plpgsql security definer set search_path = vessl, pg_temp
as $fn$
declare
  o      jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n      jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r      jsonb;
  fields text[];
  ref    text;
  claims jsonb;
  f      text;
begin
  begin
    r := coalesce(n, o);
    fields := case tg_table_name
      when 'purchase_orders' then array['status', 'cargo_ready_date', 'requested_ship_date', 'cancel_date']
      when 'sales_orders'    then array['status', 'cargo_ready_date', 'indc_date', 'cancel_date']
      when 'shipments'       then array['status', 'estimated_departure', 'estimated_arrival']
    end;
    ref := case tg_table_name
      when 'purchase_orders' then coalesce(r->>'order_number', r->>'client_po_number')
      when 'sales_orders'    then coalesce(r->>'so_number', r->>'order_number', r->>'client_po_number')
      else r->>'shipment_number'
    end;
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    foreach f in array fields loop
      if (o->>f) is distinct from (n->>f) then
        insert into vessl.order_history
          (table_name, row_id, order_ref, action, field, old_value, new_value,
           actor_id, actor_email, db_role, app_name, via, note)
        values
          (tg_table_name, (r->>'id')::uuid, ref, lower(tg_op), f, o->>f, n->>f,
           nullif(claims->>'sub', '')::uuid, nullif(claims->>'email', ''),
           coalesce(nullif(current_setting('role', true), 'none'), session_user),
           nullif(current_setting('application_name', true), ''),
           case when pg_trigger_depth() > 1 then 'trigger' else 'direct' end,
           nullif(current_setting('vessl.change_note', true), ''));
      end if;
    end loop;
  exception when others then
    raise warning 'order_history not recorded for % %, %', tg_table_name, coalesce(r->>'id', 'unknown'), sqlerrm;
  end;
  return null;
end
$fn$;

-- ── THE TRIGGERS ───────────────────────────────────────────────────────────
create trigger trg_order_history after insert or update or delete on vessl.purchase_orders
  for each row execute function vessl.record_order_history();
create trigger trg_order_history after insert or update or delete on vessl.sales_orders
  for each row execute function vessl.record_order_history();
create trigger trg_order_history after insert or update or delete on vessl.shipments
  for each row execute function vessl.record_order_history();

-- ── PROBES ─────────────────────────────────────────────────────────────────
create temp table _probe107 (probe text, result text) on commit drop;

do $probe$
declare
  res     text;
  n_upd   integer;
  v_po    uuid := (select po_id from _k107);
  v_user  uuid := (select probe_user from _k107);
  v_email text := (select u.email from auth.users u where u.id = (select probe_user from _k107));
begin
  -- p1 a signed-in staff user changes a PO status. The ids and email are in
  -- variables because the authenticated role cannot read this script temp tables.
  -- Every piece of the result is spelled out, so a missing piece reads as
  -- missing rather than turning the whole line NULL; the first piece is how many
  -- PO rows the update touched, so a refusal by row level security reads 0.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user::text, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update vessl.purchase_orders set status = 'confirmed' where id = v_po;
    get diagnostics n_upd = row_count;
    perform set_config('role', 'none', true);
    select 'updated ' || n_upd::text || '/rows ' || count(*)::text
           || '/' || coalesce(max(h.action), 'missing') || '/' || coalesce(max(h.field), 'missing')
           || '/' || coalesce(max(h.old_value), 'missing') || '/' || coalesce(max(h.new_value), 'missing')
           || '/id ' || coalesce((max(h.actor_id::text) = v_user::text)::text, 'missing')
           || '/email ' || coalesce((max(h.actor_email) = v_email)::text, 'missing')
           || '/' || coalesce(max(h.db_role), 'missing') || '/' || coalesce(max(h.via), 'missing')
           || '/' || coalesce(max(h.note), 'no note')
      into res from vessl.order_history h;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p1', res);
  end;

  -- p2 every field re-saved unchanged
  begin
    update vessl.purchase_orders p
       set status = p.status, cargo_ready_date = p.cargo_ready_date, requested_ship_date = p.requested_ship_date,
           cancel_date = p.cancel_date, updated_at = p.updated_at
     where p.id = (select po_id from _k107);
    select count(*)::text into res from vessl.order_history;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p2', res);
  end;

  -- p3 a postgres script with a change note moves an SO date
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('vessl.change_note', 'probe 107', true);
    update vessl.sales_orders set cargo_ready_date = cargo_ready_date + 1 where id = (select so_id from _k107);
    select count(*)::text || '/' || max(h.order_ref) || '/' || max(h.action) || '/' || max(h.field) || '/' || max(h.old_value)
           || '/' || max(h.new_value) || '/' || coalesce(max(h.actor_email), 'no actor')
           || '/' || (max(h.db_role) = coalesce(nullif(current_setting('role', true), 'none'), session_user))::text
           || '/' || max(h.via) || '/' || coalesce(max(h.note), 'no note')
      into res from vessl.order_history h;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p3', res);
  end;

  -- p4 a shipment is created, linked, set in transit and deleted
  begin
    insert into vessl.shipments (id, shipment_number) select probe_ship, 'PROBE-107' from _k107;
    insert into vessl.shipment_pos (shipment_id, purchase_order_id) select probe_ship, po_id from _k107;
    update vessl.shipments set status = 'in_transit' where id = (select probe_ship from _k107);
    delete from vessl.shipment_pos where shipment_id = (select probe_ship from _k107);
    delete from vessl.shipments where id = (select probe_ship from _k107);
    select string_agg(h.table_name || ' ' || h.action || ' ' || h.field || ' ' || coalesce(h.old_value, 'none')
                      || ' ' || coalesce(h.new_value, 'none') || ' ' || h.via, ' | ' order by h.id)
      into res from vessl.order_history h;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p4', res);
  end;

  -- p5 a PO and an SO are inserted and deleted
  begin
    insert into vessl.purchase_orders (id, order_number) select probe_po, 'PROBE-107' from _k107;
    insert into vessl.sales_orders (id, so_number) select probe_so, 'PROBE-107' from _k107;
    delete from vessl.purchase_orders where id = (select probe_po from _k107);
    delete from vessl.sales_orders where id = (select probe_so from _k107);
    select string_agg(h.table_name || ' ' || h.action || ' ' || h.field || ' ' || coalesce(h.old_value, 'none')
                      || ' ' || coalesce(h.new_value, 'none') || ' ' || h.order_ref, ' | ' order by h.id)
      into res from vessl.order_history h;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p5', res);
  end;

  -- p6 the history insert fails; the save it records still goes through
  begin
    alter table vessl.order_history add constraint probe_refuse_all check (false) not valid;
    update vessl.purchase_orders set cargo_ready_date = cargo_ready_date + 1 where id = (select po_id from _k107);
    select (select count(*) from vessl.purchase_orders p, _k107 k
             where p.id = k.po_id and p.cargo_ready_date = make_date(2027,1,2))::text
           || '/' || (select count(*) from vessl.order_history)::text
      into res;
    raise exception 'probe undo';
  exception when raise_exception then insert into _probe107 values ('p6', res);
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a, b or p row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 guards -- nothing of 107 exists, the five triggers as expected, probe rows as measured, probe ids free, p1 login is staff' as chk,
         (select (n_table + n_fn)::text || '/' || n_po_draft::text || '/' || (n_po_so + n_po_ship)::text
                 || '/' || n_so_ok::text || '/' || n_so_po::text || '/' || n_probe_ids::text
                 || '/' || n_staff_user::text from _pre107) as got,
         '0/1/0/1/0/0/1' as want
  union all
  select 'p1 signed-in staff user -- one PO row updated, one history row naming them by id and email, role authenticated, direct',
         (select result::text from _probe107 where probe = 'p1'),
         'updated 1/rows 1/update/status/draft/confirmed/id true/email true/authenticated/direct/no note'
  union all
  select 'p2 every field re-saved unchanged records nothing',
         (select result::text from _probe107 where probe = 'p2'),
         '0'
  union all
  select 'p3 postgres script -- no actor, its own role, the note',
         (select result::text from _probe107 where probe = 'p3'),
         '1/9579-00/update/cargo_ready_date/2026-12-03/2026-12-04/no actor/true/direct/probe 107'
  union all
  select 'p4 shipment created, set in transit, deleted, and the PO it moved recorded as via trigger',
         (select result::text from _probe107 where probe = 'p4'),
         'shipments insert status none created direct | shipments update status created in_transit direct | purchase_orders update status draft shipped trigger | shipments delete status in_transit none direct'
  union all
  select 'p5 PO and SO insert and delete',
         (select result::text from _probe107 where probe = 'p5'),
         'purchase_orders insert status none draft PROBE-107 | sales_orders insert status none received PROBE-107 | purchase_orders delete status draft none PROBE-107 | sales_orders delete status received none PROBE-107'
  union all
  select 'p6 a failing history insert does not fail the save -- the PO date moved, no history row',
         (select result::text from _probe107 where probe = 'p6'),
         '1/0'
  union all
  select 'b1 the table -- row level security on, staff read policy, authenticated may read but not write, anon nothing',
         (select c.relrowsecurity::text from pg_class c where c.oid = 'vessl.order_history'::regclass)
         || '/' || (select count(*)::text from pg_policy where polrelid = 'vessl.order_history'::regclass)
         || '/' || has_table_privilege('authenticated', 'vessl.order_history', 'SELECT')::text
         || '/' || (has_table_privilege('authenticated', 'vessl.order_history', 'INSERT')
                    or has_table_privilege('authenticated', 'vessl.order_history', 'UPDATE')
                    or has_table_privilege('authenticated', 'vessl.order_history', 'DELETE'))::text
         || '/' || has_table_privilege('anon', 'vessl.order_history', 'SELECT')::text,
         'true/1/true/false/false'
  union all
  select 'b2 the function -- security definer, owned by postgres, fixed search path',
         (select p.prosecdef::text || '/' || pg_get_userbyid(p.proowner) || '/' || array_to_string(p.proconfig, ',')
            from pg_proc p where p.oid = 'vessl.record_order_history()'::regprocedure),
         'true/postgres/search_path=vessl, pg_temp'
  union all
  select 'b3 three history triggers, enabled, beside the five that were there',
         (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || '.' || t.tgenabled::text, ','
                            order by t.tgrelid::regclass::text, t.tgname)
            from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid in ('vessl.purchase_orders'::regclass, 'vessl.sales_orders'::regclass,
                               'vessl.shipments'::regclass, 'vessl.shipment_pos'::regclass)),
         'vessl.purchase_orders.trg_order_history.O,vessl.purchase_orders.trg_sync_po_to_so.O,vessl.sales_orders.trg_notify_portal_on_so_status.O,vessl.sales_orders.trg_order_history.O,vessl.sales_orders.trg_sync_so_status_down.O,vessl.sales_orders.trg_sync_so_to_po.O,vessl.shipments.trg_order_history.O,vessl.shipments.trg_sync_shipment_status.O'
  union all
  select 'b4 the history table is empty -- every probe row was undone',
         (select count(*)::text from vessl.order_history),
         '0'
  union all
  select 'b5 every PO, SO, shipment and link unchanged',
         (select ((select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.purchase_orders p) = x.h_po)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), '')) from vessl.sales_orders so) = x.h_so)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s) = x.h_ship)::text
                 || '/' || ((select md5(coalesce(string_agg(sp.shipment_id::text || '/' || sp.purchase_order_id::text, ','
                              order by sp.shipment_id, sp.purchase_order_id), '')) from vessl.shipment_pos sp) = x.h_links)::text
            from _pre107 x),
         'true/true/true/true'
  union all
  select 'b6 no portal notification and no outbound request queued',
         (select ((select count(*) from portal.notifications) = x.n_notif)::text
                 || '/' || ((select count(*) from net.http_request_queue) = x.n_http)::text from _pre107 x),
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
