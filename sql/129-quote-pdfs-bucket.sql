-- 129 -- A private storage bucket for factory quote PDFs, and quotes.pdf_path.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 129r.
-- Run this BEFORE deploying the code that uploads to the bucket. The quote
-- form writes pdf_path only on a quote that imported a PDF, so ordinary saves
-- keep working before this runs -- only an import would fail.
--
-- WHAT IT DOES.
--   1 Bucket quote-pdfs. Private (no public URL -- these are factory prices),
--     application/pdf only, 25 MB limit (26214400 bytes). The type and size
--     limits are enforced by the Storage API on upload, not by Postgres.
--   2 Two policies on storage.objects, both for signed-in staff only
--     (vessl.is_staff, the function every quote policy already uses).
--       quote-pdfs staff read    SELECT, any object in the bucket.
--       quote-pdfs staff upload  INSERT, only at a path shaped
--         (draft or a quote uuid) / (digits) - (name) .pdf
--     No UPDATE and no DELETE policy. An upload never overwrites, and a PDF
--     once stored stays until someone removes it in the dashboard.
--   3 vessl.quotes.pdf_path text, nullable, no default, with a comment. The
--     object path inside quote-pdfs. Every existing quote reads NULL.
--
-- NO GRANT CHANGES. authenticated already holds its privileges on
-- storage.objects and on vessl.quotes; a table grant covers a column added
-- later. The guard checks no quotes column has a column-level grant.
--
-- TRIGGERS. Inserting a bucket fires the Supabase bucket triggers; the
-- lifecycle columns stay NULL, which they accept. Adding a column fires none.
-- The probes write storage rows inside blocks that are always undone.
--
-- GUARDS, before any change.
--   no bucket quote-pdfs yet
--   neither policy name exists yet
--   quotes.pdf_path does not exist yet
--   no column of vessl.quotes has a column-level grant
--
-- PROBES, each undone.
--   p1 As Jenn signed in, uploading draft/1-probe.pdf is accepted.
--   p2 As Jenn signed in, uploading at a bad path (notes/probe.pdf) is refused.
--   p3 As a signed-in user who is not staff, uploading draft/1-probe.pdf is
--      refused.
--   p4 As Jenn signed in, an object in the bucket is visible (1).
--   p5 As a signed-in user who is not staff, the same object is not (0).
--   p6 As Jenn signed in, setting pdf_path on the oldest quote is accepted.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 129 probes, undone';

create temp table _pre129 on commit drop as
  select
    (select count(*) from storage.buckets where id = 'quote-pdfs')                               as has_bucket,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('quote-pdfs staff read', 'quote-pdfs staff upload'))                   as n_pol,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_path')       as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.quotes'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.quotes)                                                          as n_quotes,
    (select count(*) from storage.objects)                                                       as n_objects,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')   as n_obj_pol,
    -- Every quote, every column, so b6 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
       from vessl.quotes q)                                                                      as h_rows;

do $guard$
begin
  if (select has_bucket from _pre129) <> 0 then
    raise exception 'bucket quote-pdfs already exists, nothing changed';
  end if;
  if (select n_pol from _pre129) <> 0 then
    raise exception 'a quote-pdfs policy already exists, nothing changed';
  end if;
  if (select has_col from _pre129) <> 0 then
    raise exception 'quotes.pdf_path already exists, nothing changed';
  end if;
  if (select n_colacl from _pre129) <> 0 then
    raise exception 'a column of quotes has a column-level grant, so the new column may need one too, nothing changed';
  end if;
end
$guard$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('quote-pdfs', 'quote-pdfs', false, 26214400, array['application/pdf']);

create policy "quote-pdfs staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'quote-pdfs' and vessl.is_staff());

create policy "quote-pdfs staff upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'quote-pdfs'
    and vessl.is_staff()
    and name ~* '^(draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9]+-[^/]+[.]pdf$'
  );

alter table vessl.quotes add column pdf_path text;
comment on column vessl.quotes.pdf_path is
  'Script 129. The factory quote PDF this quote was imported from, as an object path in the private storage bucket quote-pdfs (draft or the quote id, then timestamp-name.pdf). NULL is no PDF.';

create temp table _probe129 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  q uuid;
begin
  -- p1, as Jenn -- a well-shaped draft path.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'draft/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2, as Jenn -- a path the policy does not allow.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'notes/probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p3, as a signed-in user who is not staff.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000000129', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'draft/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p4, the object made as postgres, read back as Jenn.
  begin
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'draft/2-probe.pdf');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'quote-pdfs';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (4, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p5, the same object, read as the user who is not staff.
  begin
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'draft/2-probe.pdf');
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000000129', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'quote-pdfs';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (5, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p6, as Jenn -- pdf_path on the oldest quote, undone.
  begin
    select id into q from vessl.quotes order by created_at, id limit 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.quotes set pdf_path = 'draft/1-probe.pdf' where id = q;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe129 values (6, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, quotes = ' || (select n_quotes::text from _pre129)
           || ', storage objects = ' || (select n_objects::text from _pre129) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 bucket quote-pdfs private, 25 MB, application/pdf only',
         (select public::text || '/' || coalesce(file_size_limit::text, 'none') || '/' || coalesce(array_to_string(allowed_mime_types, ','), 'none')
            from storage.buckets where id = 'quote-pdfs')::text,
         'false/26214400/application/pdf'::text
  union all
  select 'b2 both policies exist, select and insert, for authenticated',
         (select string_agg(policyname || '=' || cmd || '=' || array_to_string(roles, ','), ' | ' order by policyname)
            from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('quote-pdfs staff read', 'quote-pdfs staff upload')),
         'quote-pdfs staff read=SELECT=authenticated | quote-pdfs staff upload=INSERT=authenticated'::text
  union all
  select 'b3 every other storage policy untouched',
         (select (count(*) - 2)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'),
         (select n_obj_pol::text from _pre129)
  union all
  select 'b4 pdf_path exists, text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_path')::text,
         'text/YES/none'::text
  union all
  select 'b5 the column carries its comment',
         (select (col_description('vessl.quotes'::regclass,
                   (select attnum from pg_attribute where attrelid = 'vessl.quotes'::regclass and attname = 'pdf_path'))
                  like 'Script 129.%')::text),
         'true'::text
  union all
  select 'b6 every quote unchanged, pdf_path blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(q) - 'pdf_path')::text, '/' order by q.id), ''))
                           = (select h_rows from _pre129) then 'same' else 'changed' end
                 || '/' || count(*) filter (where pdf_path is not null)::text
            from vessl.quotes q),
         'same/0'::text
  union all
  select 'b7 same number of storage objects, probes left nothing',
         (select count(*)::text from storage.objects), (select n_objects::text from _pre129)
  union all
  select 'b8 probes -- staff upload, bad path refused, non-staff refused, staff sees, non-staff does not, staff sets pdf_path',
         (select string_agg(result, ' | ' order by step) from _probe129),
         'allowed 1 | 42501 | 42501 | sees 1 | sees 0 | allowed 1'::text
  union all
  select 'b9 still no column-level grants on quotes',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.quotes'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'b10 po-attachments untouched, still public',
         (select public::text from storage.buckets where id = 'po-attachments'),
         'true'::text
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
