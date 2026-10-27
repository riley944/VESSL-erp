-- 53 -- purchase_orders.production_pct, the column the Production Board has
-- always written to and that never existed.
--
-- The board reads production_pct and its plus and minus 10 buttons write it.
-- No table in this database has ever carried that column, so every write has
-- returned 400 and every read has seen undefined, shown as 0 percent. Until
-- 596794e the PO card select also named it, which is why the whole PO grid ran
-- on a silent fallback query for months.
--
-- Riley and Steven use the percentage, so the column is added rather than the
-- control removed.
--
-- ── THE DEFINITION, AND WHY EACH PART ───────────────────────────────────────
--   smallint         whole percentages only. setPct sends integers, clamped to
--                    0 through 100 in the browser, in steps of 10.
--   not null         the board has no way to write or show "not recorded", so a
--                    nullable column would add a state nothing can produce. 0
--                    means not started, which is how every PO already reads.
--   default 0        a constant default, so PostgreSQL 11 and later record it in
--                    the catalogue and do not rewrite the table.
--   check 0 to 100   the browser clamps, but a dashboard edit or a later import
--                    would not. The database is the only writer that cannot
--                    forget.
--
-- ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────
-- trg_sync_po_to_so fires on UPDATE OF status only, so a board nudge will not
-- rewrite a linked sales order or trigger the portal notification.
-- v_purchase_order_totals depends on purchase_orders, and a view keeps the
-- column list it was created with, so it is unaffected.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 68 purchase orders. production_pct exists in no table in any schema.
-- authenticated holds table-level privileges on purchase_orders and no column
-- carries its own grant, so the new column is covered without a grant here.
-- RLS policy purchase_orders_auth_all permits the update. pgrst_ddl_watch
-- reloads the API schema cache on DDL, so no manual notify is needed.
--
-- ── THE PROBE ───────────────────────────────────────────────────────────────
-- Checking that a constraint EXISTS says nothing about whether it rejects the
-- right values, and its rendered text is not a safe thing to compare (script 49
-- b6). So the check is exercised. Each probe updates one real purchase order
-- inside its own subtransaction and then FORCES that subtransaction to roll back
-- whether the value was accepted or not. Nothing the probe does can survive,
-- even if this script is committed, and c2 and c3 prove it.

begin;

create temp table _pre53 on commit drop as
  select (select count(*) from vessl.purchase_orders) as rows_before,
         (select count(*) from information_schema.columns
           where column_name = 'production_pct')      as col_anywhere_before,
         (select count(*) from pg_constraint
           where conname = 'purchase_orders_production_pct_check') as con_before,
         (select md5(string_agg(id::text || '|' || coalesce(updated_at::text, 'null'), ',' order by id))
            from vessl.purchase_orders)                as stamp_before;

alter table vessl.purchase_orders
  add column production_pct smallint not null default 0
  constraint purchase_orders_production_pct_check check (production_pct between 0 and 100);

-- ── The probe. Results land in a temp table; every write is undone. ────────
create temp table _probe53 (val text, accepted boolean) on commit drop;

do $probe$
declare
  v int;
  target uuid := (select id from vessl.purchase_orders order by id limit 1);
begin
  foreach v in array array[-1, 0, 10, 100, 101, null]::int[] loop
    begin
      update vessl.purchase_orders set production_pct = v where id = target;
      -- Reaching here means the value was accepted. Raise anyway, so the
      -- subtransaction rolls back and the row keeps its value.
      raise exception using errcode = 'P0001', message = 'probe accepted';
    exception
      when raise_exception     then insert into _probe53 values (coalesce(v::text, 'null'), true);
      when check_violation     then insert into _probe53 values (coalesce(v::text, 'null'), false);
      when not_null_violation  then insert into _probe53 values (coalesce(v::text, 'null'), false);
    end;
  end loop;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 production_pct existed in no table before this script' as chk,
         (select col_anywhere_before::text from _pre53) as got, '0' as want
  union all
  select 'a1 and no constraint of that name existed',
         (select con_before::text from _pre53), '0'
  union all
  select 'b1 the column is a smallint',
         (select data_type::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'purchase_orders'
             and column_name = 'production_pct'), 'smallint'
  union all
  select 'b2 it is not nullable',
         (select is_nullable::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'purchase_orders'
             and column_name = 'production_pct'), 'NO'
  union all
  -- Either rendering is the same default. Comparing one exact string is the
  -- trap b6 of script 49 fell into, so both accepted forms are named.
  select 'b3 its default is 0',
         (select (column_default in ('0', '0::smallint'))::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'purchase_orders'
             and column_name = 'production_pct'), 'true'
  union all
  -- STRUCTURAL. One validated CHECK, on this table, naming this column alone.
  select 'b4 one validated check constraint on production_pct alone',
         (select count(*)::text from pg_constraint con
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
           where con.conrelid = 'vessl.purchase_orders'::regclass
             and con.conname = 'purchase_orders_production_pct_check'
             and con.contype = 'c' and con.convalidated
             and a.attname = 'production_pct'
             and array_length(con.conkey, 1) = 1), '1'
  union all
  -- BEHAVIOURAL. The probe tried six values against a real row.
  select 'b5 the probe ran all six values',
         (select count(*)::text from _probe53), '6'
  union all
  select 'b6 it accepted 0, 10 and 100, the values the board can send',
         (select string_agg(val, ',' order by val::int) from _probe53 where accepted and val <> 'null'), '0,10,100'
  union all
  select 'b7 it rejected minus 1 and 101',
         (select string_agg(val, ',' order by val::int) from _probe53 where not accepted and val <> 'null'), '-1,101'
  union all
  select 'b8 and it rejected null',
         (select (not accepted)::text from _probe53 where val = 'null'), 'true'
  union all
  select 'c1 every existing purchase order reads 0',
         (select (count(*) filter (where production_pct = 0) = count(*))::text from vessl.purchase_orders), 'true'
  union all
  select 'c2 no purchase order created or deleted',
         (select ((select count(*) from vessl.purchase_orders) - (select rows_before from _pre53))::text), '0'
  union all
  -- THE PROBE LEFT NOTHING. Every id and updated_at is exactly as it was, so
  -- neither the add nor the probe touched a row, and no trigger stamped one.
  select 'c3 no row id or updated_at moved',
         (select (md5(string_agg(id::text || '|' || coalesce(updated_at::text, 'null'), ',' order by id))
                   = (select stamp_before from _pre53))::text
            from vessl.purchase_orders), 'true'
  union all
  select 'd1 authenticated can update the new column',
         (select has_column_privilege('authenticated', 'vessl.purchase_orders', 'production_pct', 'update')::text), 'true'
  union all
  select 'd2 anon cannot read it',
         (select has_column_privilege('anon', 'vessl.purchase_orders', 'production_pct', 'select')::text), 'false'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
