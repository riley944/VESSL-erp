-- 123 -- Notes on shipments and freight quotes, in order_notes.shipment_id and
-- order_notes.shipment_quote_id.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 123r.
-- Run this BEFORE the code that writes either column is deployed -- the notes
-- panel inserts them and /api/orders/notify selects them. The code now live
-- never names them, so adding them changes nothing for the live site.
--
-- WHAT IT DOES.
--   shipment_id, nullable uuid, no default, a foreign key to
--   vessl.shipments(id) ON DELETE CASCADE, with order_notes_shipment_idx.
--   shipment_quote_id, nullable uuid, no default, a foreign key to
--   vessl.shipment_quotes(id) ON DELETE CASCADE, with
--   order_notes_shipment_quote_idx. A freight quote sent to several forwarders
--   is several shipment_quotes rows sharing rfq_group_id, which has no table of
--   its own -- so a note belongs to the row it was posted from, and the page
--   shows the whole group together.
--   order_notes_one_order_check is dropped and added back under the same name
--   as num_nonnulls(purchase_order_id, sales_order_id, shipment_id,
--   shipment_quote_id) = 1 -- every note on exactly one record.
--   A comment on each new column.
-- Delivery requests are not part of this script.
--
-- NO GRANT CHANGES. authenticated holds its privileges ON THE TABLE, and a
-- table grant covers a column added later. The guard checks no column carries
-- a column-level grant. The staff_only and kui_staff_only policies are FOR ALL
-- and name no columns. Probes p1 and p3 prove a signed-in staff user can write
-- each new column.
--
-- GUARDS, before any change.
--   neither column exists yet
--   no column of the table has a column-level grant
--   every note is on exactly one order now (the CHECK it replaces holds)
--
-- PROBES, each undone with its own throwaway record ZZ-123-PROBE, made as
-- postgres inside the probe and gone with it.
--   p1 As Jenn signed in through the app, a note on a shipment is accepted.
--   p2 As postgres, deleting that shipment deletes its note (0 left).
--   p3 As Jenn, a note on a freight quote is accepted.
--   p4 As postgres, deleting that freight quote deletes its note (0 left).
--   p5 As postgres, a note on a shipment and a freight quote is refused (23514).
--   p6 As postgres, a note on a PO and a shipment is refused (23514).
--   p7 As postgres, a note on none of the four is refused (23514).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 123 probes, throwaway shipment ZZ-123-PROBE, undone';

create temp table _pre123 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'order_notes'
        and column_name in ('shipment_id', 'shipment_quote_id'))                                as has_cols,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.order_notes'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes
      where num_nonnulls(purchase_order_id, sales_order_id) <> 1)                                as n_bad,
    (select count(*) from vessl.shipments)                                                       as n_ships,
    (select count(*) from vessl.shipment_quotes)                                                 as n_quotes,
    (select id from vessl.purchase_orders order by id limit 1)                                   as probe_po,
    -- Every note, every column, so b8 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
       from vessl.order_notes n)                                                                 as h_rows;

do $guard$
begin
  if (select has_cols from _pre123) <> 0 then
    raise exception 'shipment_id or shipment_quote_id already exists, nothing changed';
  end if;
  if (select n_colacl from _pre123) <> 0 then
    raise exception 'a column of order_notes has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
  if (select n_bad from _pre123) <> 0 then
    raise exception 'a note is not on exactly one order, so the widened CHECK would not validate, nothing changed';
  end if;
  if (select probe_po from _pre123) is null then
    raise exception 'no purchase order to probe with, nothing changed';
  end if;
end
$guard$;

alter table vessl.order_notes add column shipment_id uuid
  references vessl.shipments(id) on delete cascade;
create index order_notes_shipment_idx on vessl.order_notes (shipment_id);
alter table vessl.order_notes add column shipment_quote_id uuid
  references vessl.shipment_quotes(id) on delete cascade;
create index order_notes_shipment_quote_idx on vessl.order_notes (shipment_quote_id);
alter table vessl.order_notes drop constraint order_notes_one_order_check;
alter table vessl.order_notes add constraint order_notes_one_order_check
  check (num_nonnulls(purchase_order_id, sales_order_id, shipment_id, shipment_quote_id) = 1);
comment on column vessl.order_notes.shipment_id is
  'Script 123. The shipment a note is on. Exactly one of the four record columns is set (order_notes_one_order_check). Deleting the shipment deletes its notes.';
comment on column vessl.order_notes.shipment_quote_id is
  'Script 123. The freight quote (shipment_quotes row) a note was posted from. A quote sent to several forwarders is several rows sharing rfq_group_id; the page shows the whole group. Deleting the row deletes its notes.';

create temp table _probe123 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  sid uuid;
  qid uuid;
  po uuid := (select probe_po from _pre123);
  jenn json := json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated');
begin
  -- p1, as a signed-in staff user -- a note on a shipment.
  begin
    insert into vessl.shipments (shipment_number) values ('ZZ-123-PROBE') returning id into sid;
    perform set_config('request.jwt.claims', jenn::text, true);
    execute 'set local role authenticated';
    insert into vessl.order_notes (shipment_id, body, author_email)
      values (sid, 'script 123 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2, as postgres -- deleting the shipment deletes its note.
  begin
    insert into vessl.shipments (shipment_number) values ('ZZ-123-PROBE') returning id into sid;
    insert into vessl.order_notes (shipment_id, body, author_email)
      values (sid, 'script 123 probe', 'jenn@kinguniversal.com');
    delete from vessl.shipments where id = sid;
    select count(*) into n from vessl.order_notes where shipment_id = sid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (2, case when st = 'P0001' then 'left ' || n::text else st end);
  end;

  -- p3, as a signed-in staff user -- a note on a freight quote.
  begin
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-123-PROBE', 'draft') returning id into qid;
    perform set_config('request.jwt.claims', jenn::text, true);
    execute 'set local role authenticated';
    insert into vessl.order_notes (shipment_quote_id, body, author_email)
      values (qid, 'script 123 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p4, as postgres -- deleting the freight quote deletes its note.
  begin
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-123-PROBE', 'draft') returning id into qid;
    insert into vessl.order_notes (shipment_quote_id, body, author_email)
      values (qid, 'script 123 probe', 'jenn@kinguniversal.com');
    delete from vessl.shipment_quotes where id = qid;
    select count(*) into n from vessl.order_notes where shipment_quote_id = qid;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (4, case when st = 'P0001' then 'left ' || n::text else st end);
  end;

  -- p5 to p7, as postgres -- two records, two records, none, all refused.
  begin
    insert into vessl.shipments (shipment_number) values ('ZZ-123-PROBE') returning id into sid;
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-123-PROBE', 'draft') returning id into qid;
    insert into vessl.order_notes (shipment_id, shipment_quote_id, body, author_email)
      values (sid, qid, 'script 123 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (5, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.shipments (shipment_number) values ('ZZ-123-PROBE') returning id into sid;
    insert into vessl.order_notes (purchase_order_id, shipment_id, body, author_email)
      values (po, sid, 'script 123 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (6, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.order_notes (body, author_email)
      values ('script 123 probe', 'jenn@kinguniversal.com');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe123 values (7, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre123)
           || ', shipments = ' || (select n_ships::text from _pre123)
           || ', freight quotes = ' || (select n_quotes::text from _pre123) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 both columns exist, uuid, nullable, no default',
         (select string_agg(column_name || '=' || data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none'), ' ' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes'
             and column_name in ('shipment_id', 'shipment_quote_id'))::text,
         'shipment_id=uuid/YES/none shipment_quote_id=uuid/YES/none'::text
  union all
  select 'b2 shipment_id foreign key, to shipments, on delete cascade',
         (select count(*)::text || '/' || coalesce(string_agg(confdeltype::text, ''), 'none') || '/'
                 || coalesce(string_agg(confrelid::regclass::text, ''), 'none')
            from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and contype = 'f'
             and conkey = array[(select attnum from pg_attribute
                                  where attrelid = 'vessl.order_notes'::regclass and attname = 'shipment_id')]),
         '1/c/vessl.shipments'::text
  union all
  select 'b3 shipment_quote_id foreign key, to shipment_quotes, on delete cascade',
         (select count(*)::text || '/' || coalesce(string_agg(confdeltype::text, ''), 'none') || '/'
                 || coalesce(string_agg(confrelid::regclass::text, ''), 'none')
            from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and contype = 'f'
             and conkey = array[(select attnum from pg_attribute
                                  where attrelid = 'vessl.order_notes'::regclass and attname = 'shipment_quote_id')]),
         '1/c/vessl.shipment_quotes'::text
  union all
  select 'b4 both indexes',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'order_notes'
             and indexname in ('order_notes_shipment_idx', 'order_notes_shipment_quote_idx')),
         '2'::text
  union all
  select 'b5 the one-order CHECK names all four columns and is validated',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') || '/'
                 || coalesce(bool_and(pg_get_constraintdef(oid) like '%shipment_quote_id%'
                                      and pg_get_constraintdef(oid) like '%shipment_id,%'
                                      and pg_get_constraintdef(oid) like '%sales_order_id%'
                                      and pg_get_constraintdef(oid) like '%purchase_order_id%')::text, 'none')
            from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_one_order_check'),
         '1/true/true'::text
  union all
  select 'b6 both columns carry their comment',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.order_notes'::regclass
             and attname in ('shipment_id', 'shipment_quote_id')
             and col_description(attrelid, attnum) like 'Script 123.%'),
         '2'::text
  union all
  select 'b7 every note unchanged apart from the new columns',
         (select case when md5(coalesce(string_agg((to_jsonb(n) - 'shipment_id' - 'shipment_quote_id')::text, '/' order by n.id), ''))
                           = (select h_rows from _pre123) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b8 same number of notes, shipments and freight quotes, probes left nothing',
         (select count(*)::text from vessl.order_notes) || ' / ' || (select count(*)::text from vessl.shipments)
           || ' / ' || (select count(*)::text from vessl.shipment_quotes),
         (select n_notes::text || ' / ' || n_ships::text || ' / ' || n_quotes::text from _pre123)
  union all
  select 'b9 probes -- staff notes allowed; deletes cascade; two records and none refused',
         (select string_agg(result, ' | ' order by step) from _probe123),
         'allowed 1 | left 0 | allowed 1 | left 0 | 23514 | 23514 | 23514'::text
  union all
  select 'b10 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.order_notes'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, notes on shipments = '
           || (select count(*)::text from vessl.order_notes where shipment_id is not null)
           || ', on freight quotes = '
           || (select count(*)::text from vessl.order_notes where shipment_quote_id is not null),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
