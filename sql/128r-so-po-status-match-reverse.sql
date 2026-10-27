-- 128r -- Reverse of the functions and trigger from 128.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES.
--   1 Drops trg_sync_status_on_link and vessl.sync_status_on_link -- linking a
--     PO to a sales order moves nothing again.
--   2 Drops vessl.status_rank.
--   3 Puts back vessl.so_to_po_status and vessl.sync_so_status_down exactly as
--     they read before 128 (19 Oct; the trigger function had Windows line
--     endings, here plain ones -- the same text otherwise). An SO set to
--     invoiced again sends its POs to delivered.
--
-- WHAT IT DOES NOT DO. The 27-row reconcile is not undone -- those statuses
-- are true now, and order_history holds every one of them, each with the 128
-- change note (a0 counts them), should any need putting back by hand.
--
-- GUARDS, before any change.
--   the link trigger, its function and status_rank exist (128 has run)
--   so_to_po_status and sync_so_status_down read as 128 left them
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on
-- the commit. Any b row is a failed check. Zero rows means the query did not
-- run.

begin;

create temp table _pre128r on commit drop as
  select
    (select count(*) from pg_trigger
      where tgrelid = 'vessl.sales_order_pos'::regclass and tgname = 'trg_sync_status_on_link')  as has_trg,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname in ('status_rank', 'sync_status_on_link'))          as n_fn,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'so_to_po_status'
        and p.prosrc like '%when ''invoiced'' then ''invoiced''%')                                 as so_fn_128,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'sync_so_status_down'
        and p.prosrc like '%= ''invoiced'' then ''invoiced''%')                                    as down_fn_128,
    (select count(*) from vessl.order_history
      where note = 'script 128 reconcile -- Kristy, SO and PO statuses must match' and field = 'status') as n_reconciled;

do $guard$
begin
  if (select has_trg from _pre128r) <> 1 or (select n_fn from _pre128r) <> 2 then
    raise exception 'the link trigger, its function or status_rank is missing, so 128 was not committed, nothing changed';
  end if;
  if (select so_fn_128 from _pre128r) <> 1 or (select down_fn_128 from _pre128r) <> 1 then
    raise exception 'so_to_po_status or sync_so_status_down does not read as 128 left it, nothing changed';
  end if;
end
$guard$;

drop trigger trg_sync_status_on_link on vessl.sales_order_pos;
drop function vessl.sync_status_on_link();
drop function vessl.status_rank(text);

create or replace function vessl.so_to_po_status(so text)
 returns text
 language sql
 immutable
as $function$
  select case so
    when 'confirmed' then 'confirmed' when 'in_production' then 'in_production'
    when 'shipped' then 'shipped' when 'delivered' then 'delivered'
    when 'invoiced' then 'delivered' when 'closed' then 'closed'
    else null end
$function$;

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
    when NEW.status::text in ('delivered','invoiced','closed') then 'delivered'
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

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, status changes the 128 reconcile recorded (not undone) = ' || (select n_reconciled::text from _pre128r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the link trigger, its function and status_rank are gone',
         (select count(*)::text from pg_trigger where tgrelid = 'vessl.sales_order_pos'::regclass and tgname = 'trg_sync_status_on_link')
         || '/' || (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'vessl' and p.proname in ('status_rank', 'sync_status_on_link')),
         '0/0'::text
  union all
  select 'b2 so_to_po_status back to the old map',
         (coalesce(vessl.so_to_po_status('testing'), 'null') || '/' || vessl.so_to_po_status('invoiced') || '/' || vessl.so_to_po_status('closed'))::text,
         'null/delivered/closed'::text
  union all
  select 'b3 sync_so_status_down back to sending invoiced down as delivered',
         (select (p.prosrc like '%in (''delivered'',''invoiced'',''closed'') then ''delivered''%in (''delivered'',''invoiced'',''closed'') then ''delivered''%')::text
                 || '/' || p.prosecdef::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'sync_so_status_down'),
         'true/true'::text
  union all
  select 'z0 verification ran, triggers on sales_order_pos = '
           || (select count(*)::text from pg_trigger where tgrelid = 'vessl.sales_order_pos'::regclass and not tgisinternal),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
