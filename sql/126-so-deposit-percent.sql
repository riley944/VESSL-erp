-- 126 -- Sales orders carry a deposit percent, in sales_orders.deposit_percent.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 126r.
-- Run this BEFORE the code that writes it is deployed -- the Create and Edit SO
-- modals save the column. The code now live never names it, so adding it
-- changes nothing for the live site.
--
-- WHAT IT DOES. One column, its CHECK and a comment, nothing else.
--   deposit_percent, nullable numeric(5,2), no default -- the same type as
--   purchase_orders.deposit_percent. NULL is no deposit. Every existing sales
--   order reads NULL -- no backfill.
--   sales_orders_deposit_percent_check allows NULL or 0 to 100. (The PO column
--   has no such CHECK; this one starts with it.)
--
-- NO GRANT CHANGES. authenticated holds its privileges ON THE TABLE, and a
-- table grant covers a column added later. The guard checks no column carries
-- a column-level grant. Probe p1 proves a signed-in staff user can write it.
--
-- TRIGGERS. Adding a column fires none. The probes use their own throwaway sales
-- order ZZ-126-PROBE, made as postgres and undone, so no real order gains a
-- history row and no linked PO is touched (vessl.change_note labels the
-- history rows the probes write and then roll back).
--
-- GUARDS, before any change.
--   deposit_percent does not exist yet
--   no column of the table has a column-level grant
--
-- PROBES, each undone.
--   p1 As Jenn signed in through the app, setting 30 on the probe order is
--      accepted.
--   p2 As postgres, 100.5 is refused by the CHECK (23514).
--   p3 As postgres, -5 is refused by the CHECK (23514).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the count before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 126 probes, throwaway sales order ZZ-126-PROBE, undone';

create temp table _pre126 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'sales_orders'
        and column_name = 'deposit_percent')                                                     as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.sales_orders'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.sales_orders)                                                    as n_sos,
    -- Every sales order, every column, so b4 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.sales_orders s)                                                                as h_rows;

do $guard$
begin
  if (select has_col from _pre126) <> 0 then
    raise exception 'sales_orders.deposit_percent already exists, nothing changed';
  end if;
  if (select n_colacl from _pre126) <> 0 then
    raise exception 'a column of sales_orders has a column-level grant, so the new column may need one too, nothing changed';
  end if;
end
$guard$;

alter table vessl.sales_orders add column deposit_percent numeric(5,2);
alter table vessl.sales_orders add constraint sales_orders_deposit_percent_check
  check (deposit_percent is null or (deposit_percent >= 0 and deposit_percent <= 100));
comment on column vessl.sales_orders.deposit_percent is
  'Script 126. The deposit the client pays up front, as a percent of the order total. NULL is no deposit. Same type as purchase_orders.deposit_percent.';

create temp table _probe126 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  so uuid;
begin
  -- p1, as a signed-in staff user -- 30 on the probe order.
  begin
    insert into vessl.sales_orders (so_number) values ('ZZ-126-PROBE') returning id into so;
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.sales_orders set deposit_percent = 30 where id = so;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe126 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2 and p3, as postgres -- above 100 and below 0 refused.
  begin
    insert into vessl.sales_orders (so_number, deposit_percent) values ('ZZ-126-PROBE', 100.5);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe126 values (2, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.sales_orders (so_number, deposit_percent) values ('ZZ-126-PROBE', -5);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe126 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, sales orders = ' || (select n_sos::text from _pre126) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 deposit_percent exists, numeric(5,2), nullable, no default',
         (select data_type || '(' || numeric_precision::text || ',' || numeric_scale::text || ')/' || is_nullable || '/'
                 || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'sales_orders' and column_name = 'deposit_percent')::text,
         'numeric(5,2)/YES/none'::text
  union all
  select 'b2 the CHECK exists and is validated',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') from pg_constraint
           where conrelid = 'vessl.sales_orders'::regclass and conname = 'sales_orders_deposit_percent_check'),
         '1/true'::text
  union all
  select 'b3 the column carries its comment',
         (select (col_description('vessl.sales_orders'::regclass,
                   (select attnum from pg_attribute where attrelid = 'vessl.sales_orders'::regclass and attname = 'deposit_percent'))
                  like 'Script 126.%')::text),
         'true'::text
  union all
  select 'b4 every sales order unchanged, deposit_percent blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'deposit_percent')::text, '/' order by s.id), ''))
                           = (select h_rows from _pre126) then 'same' else 'changed' end
                 || '/' || count(*) filter (where deposit_percent is not null)::text
            from vessl.sales_orders s),
         'same/0'::text
  union all
  select 'b5 same number of sales orders, probes left nothing',
         (select count(*)::text from vessl.sales_orders), (select n_sos::text from _pre126)
  union all
  select 'b6 probes -- staff can set 30; 100.5 and -5 refused',
         (select string_agg(result, ' | ' order by step) from _probe126),
         'allowed 1 | 23514 | 23514'::text
  union all
  select 'b7 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.sales_orders'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, sales orders with a deposit = '
           || (select count(*)::text from vessl.sales_orders where deposit_percent is not null),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
