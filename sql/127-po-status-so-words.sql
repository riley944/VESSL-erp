-- 127 -- Purchase orders take the sales order status words, and a PO in one of
-- the new words carries it to its sales order.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed (in part) by
-- 127r -- see THE ENUM below. Run this BEFORE the code that offers the new
-- words is deployed; the code now live never writes them.
--
-- WHAT IT DOES.
--   1 vessl.order_status gains three values -- received before confirmed,
--     testing after confirmed, invoiced after delivered. The order becomes
--     draft, received, confirmed, testing, sampling, sample_approved,
--     in_production, ready_to_ship, shipped, delivered, invoiced, closed,
--     cancelled. No purchase order changes -- the draft POs stay draft.
--   2 vessl.po_to_so_status (a PO status to its linked sales order, used by
--     trg_sync_po_to_so) maps received, testing and invoiced one to one.
--     Before, all three fell to its else branch and became received -- a PO
--     set to invoiced would have knocked its sales order back to Received.
-- vessl.so_to_po_status and vessl.sync_so_status_down are NOT changed. With the
-- new words in the enum, a sales order set to testing now sends its POs to
-- testing (sync_so_status_down already maps it and only waited for the enum);
-- a sales order set to invoiced still sends its POs to delivered.
--
-- THE ENUM. A value added to an enum cannot be removed, and cannot be used in
-- the transaction that adds it. So nothing here casts to the new values -- the
-- b checks read pg_enum and call po_to_so_status (it takes and returns text).
-- 127r restores the function exactly; it cannot take the three values out.
--
-- GUARDS, before any change.
--   none of received, testing, invoiced is in vessl.order_status yet
--   po_to_so_status still reads as measured on 19 Oct (else received, and no
--   invoiced line), so this replaces that and nothing newer
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the enum before) and z0 (the enum
-- after), on the rehearsal and again on the commit. Any b row is a failed
-- check. Zero rows means the query did not run.

begin;

create temp table _pre127 on commit drop as
  select
    (select string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e
      where e.enumtypid = 'vessl.order_status'::regtype)                                         as enum_before,
    (select count(*) from pg_enum e
      where e.enumtypid = 'vessl.order_status'::regtype
        and e.enumlabel in ('received', 'testing', 'invoiced'))                                   as n_new,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'po_to_so_status'
        and p.prosrc like '%else ''received'' end%' and p.prosrc not like '%''invoiced''%')       as po_fn_old,
    (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'so_to_po_status')                                as h_so_fn,
    (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vessl' and p.proname = 'sync_so_status_down')                            as h_down_fn,
    (select count(*) from vessl.purchase_orders)                                                 as n_pos,
    (select md5(coalesce(string_agg(p.id::text || '=' || p.status::text, '/' order by p.id), ''))
       from vessl.purchase_orders p)                                                             as h_status;

do $guard$
begin
  if (select n_new from _pre127) <> 0 then
    raise exception 'order_status already has received, testing or invoiced, so 127 has run before, nothing changed';
  end if;
  if (select po_fn_old from _pre127) <> 1 then
    raise exception 'po_to_so_status no longer reads as measured on 19 Oct, nothing changed';
  end if;
end
$guard$;

alter type vessl.order_status add value 'received' before 'confirmed';
alter type vessl.order_status add value 'testing' after 'confirmed';
alter type vessl.order_status add value 'invoiced' after 'delivered';

create or replace function vessl.po_to_so_status(po text)
 returns text
 language sql
 immutable
as $function$
  select case po
    when 'draft' then 'received' when 'received' then 'received'
    when 'confirmed' then 'confirmed' when 'testing' then 'testing'
    when 'sampling' then 'confirmed' when 'sample_approved' then 'confirmed'
    when 'in_production' then 'in_production' when 'ready_to_ship' then 'in_production'
    when 'shipped' then 'shipped' when 'delivered' then 'delivered'
    when 'invoiced' then 'invoiced'
    when 'closed' then 'closed' when 'cancelled' then 'closed'
    else 'received' end
$function$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, order_status = ' || (select enum_before from _pre127) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 order_status in its new order',
         (select string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e
           where e.enumtypid = 'vessl.order_status'::regtype)::text,
         'draft, received, confirmed, testing, sampling, sample_approved, in_production, ready_to_ship, shipped, delivered, invoiced, closed, cancelled'::text
  union all
  select 'b2 po_to_so_status maps received, testing, invoiced one to one; draft still received',
         (vessl.po_to_so_status('received') || '/' || vessl.po_to_so_status('testing') || '/'
          || vessl.po_to_so_status('invoiced') || '/' || vessl.po_to_so_status('draft'))::text,
         'received/testing/invoiced/received'::text
  union all
  select 'b3 po_to_so_status unchanged for the old words',
         (vessl.po_to_so_status('confirmed') || '/' || vessl.po_to_so_status('sampling') || '/'
          || vessl.po_to_so_status('sample_approved') || '/' || vessl.po_to_so_status('in_production') || '/'
          || vessl.po_to_so_status('ready_to_ship') || '/' || vessl.po_to_so_status('shipped') || '/'
          || vessl.po_to_so_status('delivered') || '/' || vessl.po_to_so_status('closed') || '/'
          || vessl.po_to_so_status('cancelled'))::text,
         'confirmed/confirmed/confirmed/in_production/in_production/shipped/delivered/closed/closed'::text
  union all
  select 'b4 po_to_so_status still sql, immutable, not security definer',
         (select l.lanname || '/' || p.provolatile::text || '/' || p.prosecdef::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
           where n.nspname = 'vessl' and p.proname = 'po_to_so_status')::text,
         'sql/i/false'::text
  union all
  select 'b5 so_to_po_status and sync_so_status_down untouched',
         (select case when md5(p.prosrc) = (select h_so_fn from _pre127) then 'same' else 'changed' end
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'so_to_po_status')
           || '/' ||
         (select case when md5(p.prosrc) = (select h_down_fn from _pre127) then 'same' else 'changed' end
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'sync_so_status_down'),
         'same/same'::text
  union all
  select 'b6 every purchase order status unchanged',
         (select case when md5(coalesce(string_agg(p.id::text || '=' || p.status::text, '/' order by p.id), ''))
                           = (select h_status from _pre127) then 'same' else 'changed' end
            from vessl.purchase_orders p),
         'same'::text
  union all
  select 'b7 same number of purchase orders',
         (select count(*)::text from vessl.purchase_orders), (select n_pos::text from _pre127)
  union all
  select 'z0 verification ran, order_status = '
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
