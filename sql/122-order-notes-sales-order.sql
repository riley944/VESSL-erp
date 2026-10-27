-- 122 -- Notes on sales orders, in order_notes.sales_order_id.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 122r.
-- Run this BEFORE the code that writes sales_order_id is deployed -- the new
-- notes panel inserts it on a sales order and /api/orders/notify selects it.
-- The code now live never names the column, so adding it changes nothing for
-- the live site.
--
-- WHAT IT DOES.
--   sales_order_id, nullable uuid, no default, a foreign key to
--   vessl.sales_orders(id) ON DELETE CASCADE -- the same rule purchase_order_id
--   already has, so deleting a sales order takes its notes with it.
--   order_notes_so_idx on it, as order_notes_po_idx serves purchase_order_id.
--   order_notes_one_order_check, num_nonnulls(purchase_order_id,
--   sales_order_id) = 1 -- every note belongs to exactly one order, a PO or an
--   SO, never both and never neither.
--   A new comment on notify_to. NULL now means NO ONE was notified (a quiet
--   note); All is saved as the full list of staff emails picked. Script 121
--   said NULL was All; no note was ever saved that way (the table was empty
--   when this was written), so no row changes meaning.
--
-- NO GRANT CHANGES. authenticated holds its privileges ON THE TABLE, and a
-- table grant covers a column added later. The guard checks no column carries
-- a column-level grant. The staff_only and kui_staff_only policies are FOR ALL
-- and name no columns. Probe p1 proves a signed-in staff user can write it.
--
-- GUARDS, before any change.
--   sales_order_id does not exist yet
--   no column of the table has a column-level grant
--   no note without a purchase_order_id (so the new CHECK can validate)
--
-- PROBES, each undone. A throwaway sales order ZZ-122-PROBE is made first, as
-- postgres, inside the probe block and undone with it.
--   p1 As Jenn signed in through the app, a note on that sales order is accepted.
--   p2 As postgres, a note naming both a PO and an SO is refused (23514).
--   p3 As postgres, a note naming neither is refused (23514).
--   p4 As postgres, deleting the sales order deletes its note (0 left).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 122 probes, throwaway sales order ZZ-122-PROBE, undone';

create temp table _pre122 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'order_notes'
        and column_name = 'sales_order_id')                                                      as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.order_notes'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes where purchase_order_id is null)                     as n_no_po,
    (select count(*) from vessl.sales_orders)                                                    as n_sos,
    (select id from vessl.purchase_orders order by id limit 1)                                   as probe_po,
    -- Every note, every column, so b6 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
       from vessl.order_notes n)                                                                 as h_rows;

do $guard$
begin
  if (select has_col from _pre122) <> 0 then
    raise exception 'sales_order_id already exists, nothing changed';
  end if;
  if (select n_colacl from _pre122) <> 0 then
    raise exception 'a column of order_notes has a column-level grant, so the new column may need one too, nothing changed';
  end if;
  if (select n_no_po from _pre122) <> 0 then
    raise exception 'a note has no purchase_order_id, so the one-order CHECK would fail, nothing changed';
  end if;
  if (select probe_po from _pre122) is null then
    raise exception 'no purchase order to probe with, nothing changed';
  end if;
end
$guard$;

alter table vessl.order_notes add column sales_order_id uuid
  references vessl.sales_orders(id) on delete cascade;
create index order_notes_so_idx on vessl.order_notes (sales_order_id);
alter table vessl.order_notes add constraint order_notes_one_order_check
  check (num_nonnulls(purchase_order_id, sales_order_id) = 1);
comment on column vessl.order_notes.sales_order_id is
  'Script 122. The sales order a note is on. Exactly one of purchase_order_id and sales_order_id is set (order_notes_one_order_check). Deleting the sales order deletes its notes.';
comment on column vessl.order_notes.notify_to is
  'Scripts 121 and 122. Who the note was emailed to, as picked on the people pills -- staff email addresses. All is saved as the full list picked. NULL is no one, a quiet note with no email.';

create temp table _probe122 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  so uuid;
  po uuid := (select probe_po from _pre122);
begin
  -- p1, as a signed-in staff user -- a note on a sales order.
  begin
    insert into vessl.sales_orders (so_number) values ('ZZ-122-PROBE') returning id into so;
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.order_notes (sales_order_id, body, author_email)
      values (so, 'script 122 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe122 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2 and p3, as postgres -- both orders, then neither, refused.
  begin
    insert into vessl.sales_orders (so_number) values ('ZZ-122-PROBE') returning id into so;
    insert into vessl.order_notes (purchase_order_id, sales_order_id, body, author_email)
      values (po, so, 'script 122 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe122 values (2, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.order_notes (body, author_email)
      values ('script 122 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe122 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  -- p4, as postgres -- deleting the sales order deletes its note.
  begin
    insert into vessl.sales_orders (so_number) values ('ZZ-122-PROBE') returning id into so;
    insert into vessl.order_notes (sales_order_id, body, author_email)
      values (so, 'script 122 probe', 'jenn@kinguniversal.com');
    delete from vessl.sales_orders where id = so;
    select count(*) into n from vessl.order_notes where sales_order_id = so;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe122 values (4, case when st = 'P0001' then 'left ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre122)
           || ', sales orders = ' || (select n_sos::text from _pre122) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 sales_order_id exists, is uuid, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'sales_order_id')::text,
         'uuid/YES/none'::text
  union all
  select 'b2 the foreign key, to sales_orders, on delete cascade',
         (select count(*)::text || '/' || coalesce(string_agg(confdeltype::text, ''), 'none') || '/'
                 || coalesce(string_agg(confrelid::regclass::text, ''), 'none')
            from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and contype = 'f'
             and conkey = array[(select attnum from pg_attribute
                                  where attrelid = 'vessl.order_notes'::regclass and attname = 'sales_order_id')]),
         '1/c/vessl.sales_orders'::text
  union all
  select 'b3 the index on sales_order_id',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'order_notes' and indexname = 'order_notes_so_idx'),
         '1'::text
  union all
  select 'b4 the one-order CHECK exists and is validated',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_one_order_check'),
         '1/true'::text
  union all
  select 'b5 the notify_to comment says NULL is no one',
         (select (col_description('vessl.order_notes'::regclass,
                   (select attnum from pg_attribute where attrelid = 'vessl.order_notes'::regclass and attname = 'notify_to'))
                  like '%NULL is no one%')::text),
         'true'::text
  union all
  select 'b6 every note unchanged apart from sales_order_id',
         (select case when md5(coalesce(string_agg((to_jsonb(n) - 'sales_order_id')::text, '/' order by n.id), ''))
                           = (select h_rows from _pre122) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b7 same number of notes and sales orders, probes left nothing',
         (select count(*)::text from vessl.order_notes) || ' / ' || (select count(*)::text from vessl.sales_orders),
         (select n_notes::text || ' / ' || n_sos::text from _pre122)
  union all
  select 'b8 probes -- staff SO note allowed; both and neither refused; SO delete leaves 0 notes',
         (select string_agg(result, ' | ' order by step) from _probe122),
         'allowed 1 | 23514 | 23514 | left 0'::text
  union all
  select 'b9 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.order_notes'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, notes on sales orders = '
           || (select count(*)::text from vessl.order_notes where sales_order_id is not null),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
