-- 123r -- Reverse of 123. order_notes back to purchase and sales orders only.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the notes panel on a shipment or a freight quote
-- and the route name both columns and fail once they are gone.
--
-- WHAT IT DOES.
--   1 Deletes every note on a shipment or a freight quote. They cannot stay --
--     without their column they would belong to no record. a0 counts them.
--   2 Drops order_notes_one_order_check and adds back the 122 form,
--     num_nonnulls(purchase_order_id, sales_order_id) = 1.
--   3 Drops both indexes and both columns with their foreign keys.
-- Notes on purchase and sales orders are not touched.
--
-- GUARDS, before any change.
--   both columns exist (123 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'order_notes'
         and column_name in ('shipment_id', 'shipment_quote_id')) <> 2 then
    raise exception 'shipment_id and shipment_quote_id are not both there, so 123 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre123r on commit drop as
  select
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes where shipment_id is not null)                       as n_ship,
    (select count(*) from vessl.order_notes where shipment_quote_id is not null)                 as n_quote,
    -- Every note on a purchase or sales order, every column but the two dropped.
    (select md5(coalesce(string_agg((to_jsonb(n) - 'shipment_id' - 'shipment_quote_id')::text, '/' order by n.id), ''))
       from vessl.order_notes n where n.shipment_id is null and n.shipment_quote_id is null)    as h_orders;

delete from vessl.order_notes where shipment_id is not null or shipment_quote_id is not null;

alter table vessl.order_notes drop constraint order_notes_one_order_check;
alter table vessl.order_notes add constraint order_notes_one_order_check
  check (num_nonnulls(purchase_order_id, sales_order_id) = 1);
drop index vessl.order_notes_shipment_idx;
drop index vessl.order_notes_shipment_quote_idx;
alter table vessl.order_notes drop column shipment_id;
alter table vessl.order_notes drop column shipment_quote_id;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre123r)
           || ', on shipments and deleted = ' || (select n_ship::text from _pre123r)
           || ', on freight quotes and deleted = ' || (select n_quote::text from _pre123r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 both columns are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes'
             and column_name in ('shipment_id', 'shipment_quote_id')),
         '0'::text
  union all
  select 'b2 both indexes are gone',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'order_notes'
             and indexname in ('order_notes_shipment_idx', 'order_notes_shipment_quote_idx')),
         '0'::text
  union all
  select 'b3 the one-order CHECK is the two-column form again, validated',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') || '/'
                 || coalesce(bool_and(pg_get_constraintdef(oid) not like '%shipment%')::text, 'none')
            from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_one_order_check'),
         '1/true/true'::text
  union all
  select 'b4 every note on a purchase or sales order unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
                           = (select h_orders from _pre123r) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b5 notes left = notes before minus those deleted',
         (select count(*)::text from vessl.order_notes),
         (select (n_notes - n_ship - n_quote)::text from _pre123r)
  union all
  select 'z0 verification ran, notes = ' || (select count(*)::text from vessl.order_notes),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
