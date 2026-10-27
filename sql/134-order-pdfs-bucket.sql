-- 134 -- A private storage bucket for client PO PDFs, and sales_orders.pdf_path.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 134r.
-- Run this BEFORE deploying the code that uploads to the bucket (Import from
-- PO PDF on the sales order form). Modelled on 129, the quote-pdfs bucket.
--
-- WHAT IT DOES.
--   1 Bucket order-pdfs. Private (no public URL -- client POs carry prices),
--     application/pdf only, 25 MB limit (26214400 bytes). The type and size
--     limits are enforced by the Storage API on upload, not by Postgres.
--   2 Two policies on storage.objects, both for signed-in staff only
--     (vessl.is_staff).
--       order-pdfs staff read    SELECT, any object in the bucket.
--       order-pdfs staff upload  INSERT, only at a path shaped
--         (draft or a sales order uuid) / (digits) - (name) .pdf
--     No UPDATE and no DELETE policy. An upload never overwrites, and a PDF
--     once stored stays until someone removes it in the dashboard.
--   3 vessl.sales_orders.pdf_path text, nullable, no default, with a comment.
--     The object path inside order-pdfs. Every existing sales order reads NULL.
--
-- NOT po-attachments. That bucket is public and its policies let any signed-in
-- user read, upload and delete -- wrong for client POs. It is left untouched.
--
-- NO GRANT CHANGES. authenticated already holds its privileges on
-- storage.objects and on vessl.sales_orders; a table grant covers a column added
-- later. The guard checks no sales_orders column has a column-level grant.
--
-- TRIGGERS. Inserting a bucket fires the Supabase bucket triggers; the
-- lifecycle columns stay NULL, which they accept. Adding a column fires none.
-- Probe p6 updates a throwaway sales order ZZ-134-PROBE, made as postgres
-- inside a block that is always undone, so no real order gains a history row
-- (vessl.change_note labels the rows the probe writes and then rolls back).
--
-- GUARDS, before any change.
--   no bucket order-pdfs yet
--   neither policy name exists yet
--   sales_orders.pdf_path does not exist yet
--   no column of vessl.sales_orders has a column-level grant
--
-- PROBES, each undone.
--   p1 As Jenn signed in, uploading draft/1-probe.pdf is accepted.
--   p2 As Jenn signed in, uploading at a bad path (notes/probe.pdf) is refused.
--   p3 As a signed-in user who is not staff, uploading draft/1-probe.pdf is
--      refused.
--   p4 As Jenn signed in, an object in the bucket is visible (1).
--   p5 As a signed-in user who is not staff, the same object is not (0).
--   p6 As Jenn signed in, setting pdf_path on the probe sales order is accepted.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 134 probes, throwaway sales order ZZ-134-PROBE, undone';

create temp table _pre134 on commit drop as
  select
    (select count(*) from storage.buckets where id = 'order-pdfs')                               as has_bucket,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('order-pdfs staff read', 'order-pdfs staff upload'))                   as n_pol,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'sales_orders' and column_name = 'pdf_path') as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.sales_orders'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.sales_orders)                                                    as n_sos,
    (select count(*) from storage.objects)                                                       as n_objects,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')   as n_obj_pol,
    -- Every sales order, every column, so b6 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.sales_orders s)                                                                as h_rows;

do $guard$
begin
  if (select has_bucket from _pre134) <> 0 then
    raise exception 'bucket order-pdfs already exists, nothing changed';
  end if;
  if (select n_pol from _pre134) <> 0 then
    raise exception 'an order-pdfs policy already exists, nothing changed';
  end if;
  if (select has_col from _pre134) <> 0 then
    raise exception 'sales_orders.pdf_path already exists, nothing changed';
  end if;
  if (select n_colacl from _pre134) <> 0 then
    raise exception 'a column of sales_orders has a column-level grant, so the new column may need one too, nothing changed';
  end if;
end
$guard$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('order-pdfs', 'order-pdfs', false, 26214400, array['application/pdf']);

create policy "order-pdfs staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'order-pdfs' and vessl.is_staff());

create policy "order-pdfs staff upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-pdfs'
    and vessl.is_staff()
    and name ~* '^(draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9]+-[^/]+[.]pdf$'
  );

alter table vessl.sales_orders add column pdf_path text;
comment on column vessl.sales_orders.pdf_path is
  'Script 134. The client PO PDF this sales order was imported from, as an object path in the private storage bucket order-pdfs (draft or the sales order id, then timestamp-name.pdf). NULL is no PDF.';

create temp table _probe134 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  so uuid;
begin
  -- p1, as Jenn -- a well-shaped draft path.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('order-pdfs', 'draft/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2, as Jenn -- a path the policy does not allow.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('order-pdfs', 'notes/probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p3, as a signed-in user who is not staff.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000000134', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('order-pdfs', 'draft/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p4, the object made as postgres, read back as Jenn.
  begin
    insert into storage.objects (bucket_id, name) values ('order-pdfs', 'draft/2-probe.pdf');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'order-pdfs';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (4, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p5, the same object, read as the user who is not staff.
  begin
    insert into storage.objects (bucket_id, name) values ('order-pdfs', 'draft/2-probe.pdf');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000000134', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'order-pdfs';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (5, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p6, as Jenn -- pdf_path on a throwaway sales order made as postgres, undone.
  begin
    insert into vessl.sales_orders (so_number) values ('ZZ-134-PROBE') returning id into so;
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.sales_orders set pdf_path = 'draft/1-probe.pdf' where id = so;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe134 values (6, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, sales orders = ' || (select n_sos::text from _pre134)
           || ', storage objects = ' || (select n_objects::text from _pre134) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 bucket order-pdfs private, 25 MB, application/pdf only',
         (select public::text || '/' || coalesce(file_size_limit::text, 'none') || '/' || coalesce(array_to_string(allowed_mime_types, ','), 'none')
            from storage.buckets where id = 'order-pdfs')::text,
         'false/26214400/application/pdf'::text
  union all
  select 'b2 both policies exist, select and insert, for authenticated',
         (select string_agg(policyname || '=' || cmd || '=' || array_to_string(roles, ','), ' | ' order by policyname)
            from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('order-pdfs staff read', 'order-pdfs staff upload')),
         'order-pdfs staff read=SELECT=authenticated | order-pdfs staff upload=INSERT=authenticated'::text
  union all
  select 'b3 every other storage policy untouched',
         (select (count(*) - 2)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'),
         (select n_obj_pol::text from _pre134)
  union all
  select 'b4 pdf_path exists, text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'sales_orders' and column_name = 'pdf_path')::text,
         'text/YES/none'::text
  union all
  select 'b5 the column carries its comment',
         (select (col_description('vessl.sales_orders'::regclass,
                   (select attnum from pg_attribute where attrelid = 'vessl.sales_orders'::regclass and attname = 'pdf_path'))
                  like 'Script 134.%')::text),
         'true'::text
  union all
  select 'b6 every sales order unchanged, pdf_path blank on all, probe order gone',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'pdf_path')::text, '/' order by s.id), ''))
                           = (select h_rows from _pre134) then 'same' else 'changed' end
                 || '/' || count(*) filter (where pdf_path is not null)::text
                 || '/' || count(*) filter (where so_number = 'ZZ-134-PROBE')::text
            from vessl.sales_orders s),
         'same/0/0'::text
  union all
  select 'b7 same number of storage objects, probes left nothing',
         (select count(*)::text from storage.objects), (select n_objects::text from _pre134)
  union all
  select 'b8 probes -- staff upload, bad path refused, non-staff refused, staff sees, non-staff does not, staff sets pdf_path',
         (select string_agg(result, ' | ' order by step) from _probe134),
         'allowed 1 | 42501 | 42501 | sees 1 | sees 0 | allowed 1'::text
  union all
  select 'b9 still no column-level grants on sales_orders',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.sales_orders'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'b10 po-attachments still public, quote-pdfs still private',
         (select string_agg(id || '=' || public::text, ',' order by id) from storage.buckets where id in ('po-attachments', 'quote-pdfs')),
         'po-attachments=true,quote-pdfs=false'::text
  union all
  select 'z0 verification ran, buckets = '
           || (select string_agg(id, ',' order by id) from storage.buckets),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
