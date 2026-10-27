-- 54 -- housekeeping. The three legacy PLM tables go, the declared_stage CHECK
-- stops permitting inquiry, and order_date becomes NOT NULL on purchase orders
-- and sales orders.
--
-- ── WHY EACH IS SAFE NOW ────────────────────────────────────────────────────
-- LEGACY TABLES. programs_legacy, program_tasks_legacy and program_notes_legacy
-- are the PLM tables from before script 48. Nothing reads them. Their only
-- foreign keys run between the three of them, each carries a staff_only policy
-- that drops with it, and the trigger program_stage_touch on programs_legacy is
-- the only user of vessl.touch_program_stage, which is dropped after it. The app
-- never names them, and neither copy of KUI-portal does. rename_product_sku
-- mentions programs_legacy inside a comment only.
--
-- Their contents are archived in archive/2026-09-15-programs-legacy-BUC_157.json,
-- committed in 5489968 and hash-checked against the live tables row for row. The
-- guard below refuses to drop anything if the row counts have moved since that
-- export -- one program, eight tasks, no notes.
--
-- INQUIRY. All 335 programs carry declared_stage NULL and nothing in the app
-- writes the column. The CHECK narrows to NULL or sampling.
--
-- ORDER_DATE. Every purchase order and sales order has one today, but none of
-- the four order forms required it, and clearing the field sent an explicit
-- null, which does not fall back to the CURRENT_DATE default. 5489968 made the
-- date required on all four forms, so the constraint now matches what the app
-- enforces, rather than turning a cleared field into a raw database error. The
-- defaults stay.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- Three legacy tables present, rows 1 / 8 / 0. touch_program_stage used by one
-- trigger only. 0 programs with declared_stage inquiry. 0 null order dates on 68
-- purchase orders and 68 sales orders. No database function inserts into either
-- order table, and the portal writes neither.
--
-- ── THE PROBES ──────────────────────────────────────────────────────────────
-- A constraint existing proves nothing about what it rejects, so both are
-- exercised, the way script 53 exercised production_pct. Each probe writes one
-- real row inside its own subtransaction and then forces that subtransaction to
-- roll back, so nothing a probe does can survive a commit. c2 and c3 prove it.

begin;

create temp table _pre54 on commit drop as
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl'
             and c.relname in ('programs_legacy', 'program_tasks_legacy', 'program_notes_legacy')) as legacy_tables,
         (select count(*) from vessl.programs_legacy)      as legacy_programs,
         (select count(*) from vessl.program_tasks_legacy) as legacy_tasks,
         (select count(*) from vessl.program_notes_legacy) as legacy_notes,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'touch_program_stage') as touch_fn,
         (select count(*) from vessl.programs where declared_stage = 'inquiry')  as inquiry_rows,
         (select count(*) from vessl.purchase_orders where order_date is null)   as po_null_dates,
         (select count(*) from vessl.sales_orders where order_date is null)      as so_null_dates,
         (select count(*) from vessl.programs)        as programs_before,
         (select count(*) from vessl.purchase_orders) as po_before,
         (select count(*) from vessl.sales_orders)    as so_before,
         (select md5(string_agg(id::text || '|' || coalesce(declared_stage, 'null') || '|'
                                || coalesce(declared_stage_at::text, 'null'), ',' order by id))
            from vessl.programs) as programs_stamp,
         (select md5(string_agg(id::text || '|' || coalesce(order_date::text, 'null') || '|'
                                || coalesce(updated_at::text, 'null'), ',' order by id))
            from vessl.purchase_orders) as po_stamp,
         (select md5(string_agg(id::text || '|' || coalesce(order_date::text, 'null') || '|'
                                || coalesce(updated_at::text, 'null'), ',' order by id))
            from vessl.sales_orders) as so_stamp;

-- REFUSE, rather than drop rows the archive does not hold.
do $guard$
begin
  if (select legacy_programs from _pre54) <> 1
     or (select legacy_tasks from _pre54) <> 8
     or (select legacy_notes from _pre54) <> 0 then
    raise exception 'legacy PLM tables changed since the archive export, nothing dropped';
  end if;
end
$guard$;

-- Children first. No CASCADE, so an unexpected dependent fails the script
-- instead of being dropped with it.
drop table vessl.program_notes_legacy;
drop table vessl.program_tasks_legacy;
drop table vessl.programs_legacy;
drop function vessl.touch_program_stage();

alter table vessl.programs drop constraint programs_declared_stage_check;
alter table vessl.programs
  add constraint programs_declared_stage_check
  check (declared_stage is null or declared_stage = 'sampling');

alter table vessl.purchase_orders alter column order_date set not null;
alter table vessl.sales_orders    alter column order_date set not null;

-- ── The probes. Results land in a temp table; every write is undone. ───────
create temp table _probe54 (what text, val text, accepted boolean) on commit drop;

do $probe$
declare
  v    text;
  prog uuid := (select id from vessl.programs order by id limit 1);
  po   uuid := (select id from vessl.purchase_orders order by id limit 1);
  so   uuid := (select id from vessl.sales_orders order by id limit 1);
begin
  foreach v in array array['inquiry', 'sampling', null]::text[] loop
    begin
      update vessl.programs set declared_stage = v where id = prog;
      raise exception using errcode = 'P0001', message = 'probe accepted';
    exception
      when raise_exception then insert into _probe54 values ('declared_stage', coalesce(v, 'null'), true);
      when check_violation then insert into _probe54 values ('declared_stage', coalesce(v, 'null'), false);
    end;
  end loop;

  begin
    update vessl.purchase_orders set order_date = null where id = po;
    raise exception using errcode = 'P0001', message = 'probe accepted';
  exception
    when raise_exception    then insert into _probe54 values ('po order_date', 'null', true);
    when not_null_violation then insert into _probe54 values ('po order_date', 'null', false);
  end;

  begin
    update vessl.sales_orders set order_date = null where id = so;
    raise exception using errcode = 'P0001', message = 'probe accepted';
  exception
    when raise_exception    then insert into _probe54 values ('so order_date', 'null', true);
    when not_null_violation then insert into _probe54 values ('so order_date', 'null', false);
  end;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the three legacy tables existed before this script' as chk,
         (select legacy_tables::text from _pre54) as got, '3' as want
  union all
  select 'a1 holding exactly what the archive holds, programs tasks notes',
         (select legacy_programs::text || '/' || legacy_tasks::text || '/' || legacy_notes::text from _pre54), '1/8/0'
  union all
  select 'a2 no program had declared inquiry',
         (select inquiry_rows::text from _pre54), '0'
  union all
  select 'a3 no purchase order or sales order lacked an order date',
         (select po_null_dates::text || '/' || so_null_dates::text from _pre54), '0/0'
  union all
  select 'a4 touch_program_stage existed',
         (select touch_fn::text from _pre54), '1'
  union all
  select 'b1 all three legacy tables are gone',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl'
             and c.relname in ('programs_legacy', 'program_tasks_legacy', 'program_notes_legacy')), '0'
  union all
  select 'b2 and so is touch_program_stage',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'touch_program_stage'), '0'
  union all
  -- STRUCTURAL. One validated CHECK on programs, naming declared_stage alone.
  select 'b3 one validated check on programs.declared_stage alone',
         (select count(*)::text from pg_constraint con
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
           where con.conrelid = 'vessl.programs'::regclass
             and con.conname = 'programs_declared_stage_check'
             and con.contype = 'c' and con.convalidated
             and a.attname = 'declared_stage'
             and array_length(con.conkey, 1) = 1), '1'
  union all
  -- BEHAVIOURAL, from the probes.
  select 'b4 the check now rejects inquiry',
         (select (not accepted)::text from _probe54 where what = 'declared_stage' and val = 'inquiry'), 'true'
  union all
  select 'b5 and still accepts sampling and null',
         (select string_agg(val, ',' order by val) from _probe54 where what = 'declared_stage' and accepted), 'null,sampling'
  union all
  select 'b6 order_date is not nullable on either order table',
         (select string_agg(table_name || '=' || is_nullable, ',' order by table_name) from information_schema.columns
           where table_schema = 'vessl' and column_name = 'order_date'
             and table_name in ('purchase_orders', 'sales_orders')), 'purchase_orders=NO,sales_orders=NO'
  union all
  select 'b7 and both reject a null order date',
         (select string_agg(what || '=' || accepted::text, ',' order by what) from _probe54
           where what in ('po order_date', 'so order_date')), 'po order_date=false,so order_date=false'
  union all
  select 'b8 the CURRENT_DATE defaults are still in place',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and column_name = 'order_date'
             and table_name in ('purchase_orders', 'sales_orders')
             and column_default = 'CURRENT_DATE'), '2'
  union all
  select 'c1 no program, purchase order or sales order created or deleted',
         (select ((select count(*) from vessl.programs) - programs_before)::text || '/' ||
                 ((select count(*) from vessl.purchase_orders) - po_before)::text || '/' ||
                 ((select count(*) from vessl.sales_orders) - so_before)::text from _pre54), '0/0/0'
  union all
  -- THE PROBES LEFT NOTHING. Every declared stage and its stamp is as it was.
  select 'c2 no program stage or stamp moved',
         (select ((select md5(string_agg(id::text || '|' || coalesce(declared_stage, 'null') || '|'
                                         || coalesce(declared_stage_at::text, 'null'), ',' order by id))
                     from vessl.programs) = programs_stamp)::text from _pre54), 'true'
  union all
  select 'c3 no order date or updated_at moved on either order table',
         (select ((select md5(string_agg(id::text || '|' || coalesce(order_date::text, 'null') || '|'
                                         || coalesce(updated_at::text, 'null'), ',' order by id))
                     from vessl.purchase_orders) = po_stamp
              and (select md5(string_agg(id::text || '|' || coalesce(order_date::text, 'null') || '|'
                                         || coalesce(updated_at::text, 'null'), ',' order by id))
                     from vessl.sales_orders) = so_stamp)::text from _pre54), 'true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
