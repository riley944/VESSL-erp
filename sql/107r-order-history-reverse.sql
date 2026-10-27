-- 107r -- Reverse 107. Stops recording order history.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 107. One transaction.
--
-- WHAT IT DOES
--   1 drops trg_order_history from purchase_orders, sales_orders and shipments
--   2 drops vessl.record_order_history()
--   3 drops vessl.order_history ONLY IF IT IS EMPTY. If it holds any rows it is
--     kept, with its rows, its policy and its grants, and the script says so in
--     b2. History already recorded is evidence, and undoing the recording must
--     not destroy it. Dropping a table that holds history is a separate decision
--     and a separate script.
-- Nothing else is touched. The five triggers that were there before 107 stay.
--
-- GUARDS. The three triggers and the function exist, as 107 left them.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.
-- b2 reads dropped when the table was empty, or kept followed by its row count.

begin;

create temp table _pre107r on commit drop as
  select
    (select count(*) from pg_trigger t
      where t.tgname = 'trg_order_history'
        and t.tgrelid in ('vessl.purchase_orders'::regclass, 'vessl.sales_orders'::regclass, 'vessl.shipments'::regclass)) as n_trig,
    (select count(*) from pg_proc p where p.proname = 'record_order_history'
        and p.pronamespace = 'vessl'::regnamespace)                                                                 as n_fn,
    (select count(*) from vessl.order_history)                                                                      as n_rows,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.purchase_orders p)       as h_po,
    (select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), '')) from vessl.sales_orders so)       as h_so,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)             as h_ship;

do $guard$
begin
  if (select n_trig from _pre107r) <> 3 or (select n_fn from _pre107r) <> 1 then
    raise exception 'the three history triggers and the function are not all there, nothing changed';
  end if;
end
$guard$;

do $undo$
begin
  drop trigger trg_order_history on vessl.purchase_orders;
  drop trigger trg_order_history on vessl.sales_orders;
  drop trigger trg_order_history on vessl.shipments;
  drop function vessl.record_order_history();
  if (select n_rows from _pre107r) = 0 then
    drop table vessl.order_history;
  else
    raise notice 'vessl.order_history kept, it holds % rows', (select n_rows from _pre107r);
  end if;
end
$undo$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 guards -- three history triggers and the function were there' as chk,
         (select n_trig::text || '/' || n_fn::text from _pre107r) as got,
         '3/1' as want
  union all
  select 'b1 history triggers and function gone',
         (select count(*)::text from pg_trigger t where t.tgname = 'trg_order_history')
         || '/' || (select count(*)::text from pg_proc p where p.proname = 'record_order_history'),
         '0/0'
  union all
  select 'b2 the table dropped if it was empty, kept with every row if not',
         (select case when to_regclass('vessl.order_history') is null then 'dropped'
                      else 'kept ' || x.n_rows::text end from _pre107r x),
         (select case when x.n_rows = 0 then 'dropped' else 'kept ' || x.n_rows::text end from _pre107r x)
  union all
  select 'b3 the five triggers that were there before 107 remain',
         (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname)
            from pg_trigger t
           where not t.tgisinternal
             and t.tgrelid in ('vessl.purchase_orders'::regclass, 'vessl.sales_orders'::regclass,
                               'vessl.shipments'::regclass, 'vessl.shipment_pos'::regclass)),
         'vessl.purchase_orders.trg_sync_po_to_so,vessl.sales_orders.trg_notify_portal_on_so_status,vessl.sales_orders.trg_sync_so_status_down,vessl.sales_orders.trg_sync_so_to_po,vessl.shipments.trg_sync_shipment_status'
  union all
  select 'b4 every PO, SO and shipment unchanged',
         (select ((select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.purchase_orders p) = x.h_po)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(so)::text, '/' order by so.id), '')) from vessl.sales_orders so) = x.h_so)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s) = x.h_ship)::text
            from _pre107r x),
         'true/true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
