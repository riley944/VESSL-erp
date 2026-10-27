-- 127r -- Reverse of 127, as far as it can go.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the PO dropdowns, board and filters offer the new
-- words.
--
-- WHAT IT DOES. Puts back vessl.po_to_so_status exactly as it read before 127
-- (19 Oct). No other function is touched -- 127 changed no other.
--
-- WHAT IT CANNOT DO. received, testing and invoiced stay in vessl.order_status
-- -- Postgres has no way to drop a value from an enum short of rebuilding the
-- type. They do no harm unused. Any purchase order already in one of them stays
-- there, and with the old po_to_so_status its next status change sends its
-- sales order to Received -- a0 counts those POs so they can be moved by hand
-- first.
--
-- GUARDS, before any change.
--   po_to_so_status reads as 127 left it
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (POs in a new status) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre127r on commit drop as
  select
    (select count(*) from vessl.purchase_orders where status::text in ('received', 'testing', 'invoiced')) as n_new_status,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'po_to_so_status'
        and p.prosrc like '%when ''invoiced'' then ''invoiced''%')                                as po_fn_127;

do $guard$
begin
  if (select po_fn_127 from _pre127r) <> 1 then
    raise exception 'po_to_so_status does not read as 127 left it, nothing changed';
  end if;
end
$guard$;

create or replace function vessl.po_to_so_status(po text)
 returns text
 language sql
 immutable
as $function$
  select case po
    when 'draft' then 'received' when 'confirmed' then 'confirmed'
    when 'sampling' then 'confirmed' when 'sample_approved' then 'confirmed'
    when 'in_production' then 'in_production' when 'ready_to_ship' then 'in_production'
    when 'shipped' then 'shipped' when 'delivered' then 'delivered'
    when 'closed' then 'closed' when 'cancelled' then 'closed'
    else 'received' end
$function$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, purchase orders in received, testing or invoiced = ' || (select n_new_status::text from _pre127r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 po_to_so_status back to the old map (the new words fall to received)',
         (vessl.po_to_so_status('invoiced') || '/' || vessl.po_to_so_status('testing') || '/'
          || vessl.po_to_so_status('draft') || '/' || vessl.po_to_so_status('confirmed'))::text,
         'received/received/received/confirmed'::text
  union all
  select 'b2 po_to_so_status still sql, immutable, not security definer',
         (select l.lanname || '/' || p.provolatile::text || '/' || p.prosecdef::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
           where n.nspname = 'vessl' and p.proname = 'po_to_so_status')::text,
         'sql/i/false'::text
  union all
  select 'z0 verification ran, order_status still = '
           || (select string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e
                where e.enumtypid = 'vessl.order_status'::regtype),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
