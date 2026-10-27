-- 122r -- Reverse of 122. order_notes back to purchase orders only.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the notes panel on a sales order and the route
-- both name sales_order_id and fail once it is gone.
--
-- WHAT IT DOES.
--   1 Deletes every note on a sales order. They cannot stay -- without
--     sales_order_id they would belong to no order. a0 counts them first.
--   2 Drops order_notes_one_order_check, order_notes_so_idx and the
--     sales_order_id column with its foreign key.
--   3 Puts back the 121 comment on notify_to.
-- Notes on purchase orders are not touched.
--
-- GUARDS, before any change.
--   sales_order_id exists (122 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'sales_order_id') <> 1 then
    raise exception 'order_notes.sales_order_id does not exist, so 122 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre122r on commit drop as
  select
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes where sales_order_id is not null)                    as n_so,
    -- Every note on a purchase order, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(n) - 'sales_order_id')::text, '/' order by n.id), ''))
       from vessl.order_notes n where n.sales_order_id is null)                                  as h_po;

delete from vessl.order_notes where sales_order_id is not null;

alter table vessl.order_notes drop constraint order_notes_one_order_check;
drop index vessl.order_notes_so_idx;
alter table vessl.order_notes drop column sales_order_id;
comment on column vessl.order_notes.notify_to is
  'Script 121. Who the note was sent to, as the NOTIFY pills picked them -- email addresses. NULL is All, the whole team. Replaces assigned_to, which held one address.';

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre122r)
           || ', on sales orders and deleted = ' || (select n_so::text from _pre122r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 sales_order_id is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'sales_order_id'),
         '0'::text
  union all
  select 'b2 the CHECK and the index are gone',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_one_order_check')
           || '/' || (select count(*)::text from pg_indexes
                       where schemaname = 'vessl' and tablename = 'order_notes' and indexname = 'order_notes_so_idx'),
         '0/0'::text
  union all
  select 'b3 every note on a purchase order unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
                           = (select h_po from _pre122r) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b4 notes left = notes before minus those on sales orders',
         (select count(*)::text from vessl.order_notes),
         (select (n_notes - n_so)::text from _pre122r)
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
