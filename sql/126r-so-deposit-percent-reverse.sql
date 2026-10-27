-- 126r -- Reverse of 126. sales_orders without deposit_percent.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the SO modals, the SO page and the exports read
-- or write deposit_percent and fail once it is gone.
--
-- WHAT IT DOES. Drops sales_orders_deposit_percent_check and the
-- deposit_percent column, losing every deposit recorded on a sales order (a0
-- counts them). No other column, no other row.
--
-- GUARDS, before any change.
--   deposit_percent exists (126 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the count before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'sales_orders' and column_name = 'deposit_percent') <> 1 then
    raise exception 'sales_orders.deposit_percent does not exist, so 126 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre126r on commit drop as
  select
    (select count(*) from vessl.sales_orders)                                                    as n_sos,
    (select count(*) from vessl.sales_orders where deposit_percent is not null)                  as n_dep,
    -- Every sales order, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(s) - 'deposit_percent')::text, '/' order by s.id), ''))
       from vessl.sales_orders s)                                                                as h_rest;

alter table vessl.sales_orders drop constraint sales_orders_deposit_percent_check;
alter table vessl.sales_orders drop column deposit_percent;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, sales orders = ' || (select n_sos::text from _pre126r)
           || ', with a deposit and lost = ' || (select n_dep::text from _pre126r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the column and the CHECK are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'sales_orders' and column_name = 'deposit_percent')
           || '/' || (select count(*)::text from pg_constraint
                       where conrelid = 'vessl.sales_orders'::regclass and conname = 'sales_orders_deposit_percent_check'),
         '0/0'::text
  union all
  select 'b2 every sales order unchanged apart from the column dropped',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_rest from _pre126r) then 'same' else 'changed' end
            from vessl.sales_orders s),
         'same'::text
  union all
  select 'b3 same number of sales orders',
         (select count(*)::text from vessl.sales_orders), (select n_sos::text from _pre126r)
  union all
  select 'z0 verification ran, sales orders = ' || (select count(*)::text from vessl.sales_orders),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
