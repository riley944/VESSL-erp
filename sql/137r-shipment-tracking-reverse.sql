-- 137r -- Reverse of 137. Shipments without tracking.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the Track button, the webhook and the daily refresh
-- call vessl.apply_tracking_update and read the columns, and fail once they are
-- gone. Remove the webhook in the ShipsGo dashboard too, or it keeps posting.
--
-- WHAT IT DOES.
--   notify_portal_on_so_status back to the body as measured before 137 (md5
--     3bae3322..., length 402) -- the flag check goes
--   drops vessl.apply_tracking_update
--   drops vessl.shipment_tracking_events (a0 counts the events lost)
--   drops the partial unique index, the provider CHECK and the nine tracking
--     columns on shipments (a0 counts the tracked shipments lost)
-- Shipment statuses tracking moved stay where they are, and so do the SO and PO
-- statuses that cascaded from them. No other column, no other row.
--
-- GUARDS, before any change.
--   137 committed -- nine columns, the table and the function all exist
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%') <> 9
     or to_regclass('vessl.shipment_tracking_events') is null
     or to_regprocedure('vessl.apply_tracking_update(uuid,jsonb)') is null then
    raise exception 'the 137 columns, table and function are not all there, so 137 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre137r on commit drop as
  select
    (select count(*) from vessl.shipments where tracking_ref is not null)                         as n_tracked,
    (select count(*) from vessl.shipment_tracking_events)                                         as n_events,
    (select count(*) from vessl.shipments)                                                        as n_ship,
    -- Every row, every column but the nine dropped.
    (select md5(coalesce(string_agg((to_jsonb(s) - 'tracking_provider' - 'tracking_ref' - 'tracking_status'
                                     - 'tracking_vessel' - 'tracking_voyage' - 'tracking_eta' - 'tracking_ata'
                                     - 'tracking_checked_at' - 'tracking_error')::text, '/' order by s.id), ''))
       from vessl.shipments s)                                                                    as h_rest;

create or replace function vessl.notify_portal_on_so_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'vessl', 'portal', 'public'
as $function$
begin
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

drop function vessl.apply_tracking_update(uuid, jsonb);
drop table vessl.shipment_tracking_events;
drop index vessl.shipments_tracking_ref_key;
alter table vessl.shipments drop constraint shipments_tracking_provider_check;
alter table vessl.shipments
  drop column tracking_provider, drop column tracking_ref, drop column tracking_status,
  drop column tracking_vessel, drop column tracking_voyage, drop column tracking_eta,
  drop column tracking_ata, drop column tracking_checked_at, drop column tracking_error;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, tracked shipments/events lost = '
           || (select n_tracked::text || '/' || n_events::text from _pre137r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 columns, index, CHECK, table and function all gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name like 'tracking%')
           || '/' || (select count(*)::text from pg_indexes where schemaname = 'vessl' and indexname = 'shipments_tracking_ref_key')
           || '/' || (select count(*)::text from pg_constraint where conname = 'shipments_tracking_provider_check')
           || '/' || coalesce(to_regclass('vessl.shipment_tracking_events')::text, 'none')
           || '/' || coalesce(to_regprocedure('vessl.apply_tracking_update(uuid,jsonb)')::text, 'none'),
         '0/0/0/none/none'::text
  union all
  select 'b2 notify function is the body as measured before 137, still security definer',
         (select md5(prosrc) || '/' || length(prosrc)::text || '/' || prosecdef::text
            from pg_proc where oid = 'vessl.notify_portal_on_so_status'::regproc),
         '3bae3322000d9868f9f21c5e240894e5/402/true'::text
  union all
  select 'b3 every other shipment column unchanged, same number of shipments',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_rest from _pre137r) then 'same' else 'changed' end
            from vessl.shipments s)
           || '/' || (select count(*)::text from vessl.shipments),
         'same/' || (select n_ship::text from _pre137r)
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
