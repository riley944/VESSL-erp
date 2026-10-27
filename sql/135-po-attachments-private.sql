-- 135 -- The po-attachments bucket goes private, staff only.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 135r.
-- Run this AFTER the code that signs links is live (78cf852, deployed with
-- f7edc57 on 26 Oct). Before that code, View and the images in a generated PO
-- used public URLs, which stop working the moment the bucket is private.
--
-- WHAT IT DOES.
--   1 Bucket po-attachments. public true to false, so the public URL of every
--     file stops being served. 25 MB limit (26214400 bytes) and five types,
--     application/pdf, image/jpeg, image/png, image/gif, image/webp -- the
--     upload button takes images and PDFs. Before, no limit and any type. The
--     type and size limits are enforced by the Storage API on upload, not by
--     Postgres, and apply to new uploads only.
--   2 The three old policies go. Each let ANY signed-in user (staff or not)
--     read, upload or delete in this bucket, on bucket_id alone.
--       auth read po-attachments      SELECT
--       auth upload po-attachments    INSERT
--       auth delete po-attachments    DELETE
--   3 Three new policies on storage.objects, signed-in staff only
--     (vessl.is_staff), modelled on 134.
--       po-attachments staff read    SELECT, any object in the bucket.
--       po-attachments staff upload  INSERT, only at a path shaped
--         (uuid of an existing purchase order) / (digits) - (name)
--         which is what the PO page writes, id slash Date.now dash safeName.
--       po-attachments staff delete  DELETE, any object in the bucket (the
--         Remove button on the PO page).
--     No UPDATE policy. An upload never overwrites (upsert false).
--
-- THE FILES. 9 objects in 7 PO folders, 9061136 bytes, measured 26 Oct. All
-- 9 already sit at the shape the new upload policy allows, under a PO that
-- exists. Nothing is moved, renamed or deleted; a0 shows the counts and b5
-- proves they are the same afterwards.
--
-- NO GRANT CHANGES. authenticated already holds its privileges on
-- storage.objects. No table in vessl changes, so no order_history row and no
-- change_note.
--
-- GUARDS, before any change.
--   bucket po-attachments exists, public, no size limit, no type list
--   all three old policies exist
--   none of the three new policy names exists yet
--
-- PROBES, each undone. Jenn is staff; the other user is signed in, not staff.
--   p1 As Jenn, every object in the bucket is visible (9).
--   p2 As Jenn, one existing object, read by id, is visible (1) -- the row
--      the Storage API reads when it signs a link.
--   p3 As Jenn, uploading (existing PO folder)/1-probe.pdf is accepted.
--   p4 As Jenn, uploading at a bad shape (notes/probe.pdf) is refused.
--   p5 As Jenn, uploading under a uuid that is no purchase order is refused.
--   p6 As the user who is not staff, no object is visible (0).
--   p7 As the user who is not staff, uploading p3 path is refused.
--   p8 As Jenn, deleting a probe object made as postgres removes it (1).
--   p9 As the user who is not staff, the same delete removes nothing (0).
--   p8 and p9 set storage.allow_delete_query first, as the Storage API does,
--   so the protect_delete trigger lets the delete reach the policy. Without it
--   both would fail 42501 from the trigger and prove nothing.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre135 on commit drop as
  select
    (select count(*) from storage.buckets
      where id = 'po-attachments' and public and file_size_limit is null and allowed_mime_types is null) as bucket_as_measured,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('auth read po-attachments', 'auth upload po-attachments', 'auth delete po-attachments')) as n_old,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('po-attachments staff read', 'po-attachments staff upload', 'po-attachments staff delete')) as n_new,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')               as n_obj_pol,
    (select count(*) from storage.objects where bucket_id = 'po-attachments')                                as n_files,
    (select count(distinct split_part(name, '/', 1)) from storage.objects where bucket_id = 'po-attachments') as n_folders,
    (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'po-attachments') as n_bytes,
    (select count(*) from storage.objects)                                                                   as n_objects;

do $guard$
begin
  if (select bucket_as_measured from _pre135) <> 1 then
    raise exception 'bucket po-attachments is missing, already private, or already limited, nothing changed';
  end if;
  if (select n_old from _pre135) <> 3 then
    raise exception 'not all three old po-attachments policies exist, nothing changed';
  end if;
  if (select n_new from _pre135) <> 0 then
    raise exception 'a new po-attachments staff policy already exists, nothing changed';
  end if;
end
$guard$;

update storage.buckets
   set public = false,
       file_size_limit = 26214400,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
 where id = 'po-attachments';

drop policy "auth read po-attachments" on storage.objects;
drop policy "auth upload po-attachments" on storage.objects;
drop policy "auth delete po-attachments" on storage.objects;

create policy "po-attachments staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'po-attachments' and vessl.is_staff());

create policy "po-attachments staff upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'po-attachments'
    and vessl.is_staff()
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[^/]+$'
    and exists (select 1 from vessl.purchase_orders p
                 where p.id::text = lower(split_part(objects.name, '/', 1)))
  );

create policy "po-attachments staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'po-attachments' and vessl.is_staff());

create temp table _probe135 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  folder text;
  oid_existing uuid;
  oid_probe uuid;
begin
  -- An existing PO folder and an existing object, picked as postgres, by id.
  select split_part(name, '/', 1), id into folder, oid_existing
    from storage.objects where bucket_id = 'po-attachments'
   order by created_at, id limit 1;

  -- p1, as Jenn -- every object in the bucket.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'po-attachments';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (1, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p2, as Jenn -- one existing object, the row signing a link reads.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where id = oid_existing;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (2, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p3, as Jenn -- a well-shaped path under an existing PO.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('po-attachments', folder || '/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p4, as Jenn -- a path of the wrong shape.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('po-attachments', 'notes/probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (4, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p5, as Jenn -- the right shape under a uuid that is no purchase order.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('po-attachments', '00000000-0000-4000-8000-000000000135/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (5, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p6, as a signed-in user who is not staff -- nothing visible.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001350', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from storage.objects where bucket_id = 'po-attachments';
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (6, case when st = 'P0001' then 'sees ' || n::text else st end);
  end;

  -- p7, the same user -- the p3 upload.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001350', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into storage.objects (bucket_id, name) values ('po-attachments', folder || '/1-probe.pdf');
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (7, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p8, as Jenn -- delete a probe object made as postgres, by id.
  begin
    insert into storage.objects (bucket_id, name) values ('po-attachments', folder || '/2-probe.pdf') returning id into oid_probe;
    perform set_config('storage.allow_delete_query', 'true', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from storage.objects where id = oid_probe;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (8, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p9, the user who is not staff -- the same delete.
  begin
    insert into storage.objects (bucket_id, name) values ('po-attachments', folder || '/2-probe.pdf') returning id into oid_probe;
    perform set_config('storage.allow_delete_query', 'true', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001350', 'email', '<contact>', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from storage.objects where id = oid_probe;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe135 values (9, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, po-attachments files = ' || (select n_files::text from _pre135)
           || ', folders = ' || (select n_folders::text from _pre135)
           || ', bytes = ' || (select n_bytes::text from _pre135)
           || ', storage policies = ' || (select n_obj_pol::text from _pre135) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 bucket po-attachments private, 25 MB, five types',
         (select public::text || '/' || coalesce(file_size_limit::text, 'none') || '/' || coalesce(array_to_string(allowed_mime_types, ','), 'none')
            from storage.buckets where id = 'po-attachments')::text,
         'false/26214400/application/pdf,image/jpeg,image/png,image/gif,image/webp'::text
  union all
  select 'b2 the three new policies exist, delete select insert, for authenticated',
         (select string_agg(policyname || '=' || cmd || '=' || array_to_string(roles, ','), ' | ' order by policyname)
            from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('po-attachments staff read', 'po-attachments staff upload', 'po-attachments staff delete')),
         'po-attachments staff delete=DELETE=authenticated | po-attachments staff read=SELECT=authenticated | po-attachments staff upload=INSERT=authenticated'::text
  union all
  select 'b3 the three old policies gone',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('auth read po-attachments', 'auth upload po-attachments', 'auth delete po-attachments')),
         '0'::text
  union all
  select 'b4 every other storage policy untouched',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname not in ('po-attachments staff read', 'po-attachments staff upload', 'po-attachments staff delete')),
         (select (n_obj_pol - 3)::text from _pre135)
  union all
  select 'b5 files, folders and bytes unchanged, probes left nothing anywhere',
         (select count(*)::text || '/' || count(distinct split_part(name, '/', 1))::text || '/' || coalesce(sum((metadata->>'size')::bigint), 0)::text
            from storage.objects where bucket_id = 'po-attachments')
           || '/' || (select count(*)::text from storage.objects),
         (select n_files::text || '/' || n_folders::text || '/' || n_bytes::text || '/' || n_objects::text from _pre135)
  union all
  select 'b6 every existing file fits the new upload shape under a real PO',
         (select count(*)::text from storage.objects o
           where o.bucket_id = 'po-attachments'
             and o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[^/]+$'
             and exists (select 1 from vessl.purchase_orders p where p.id::text = lower(split_part(o.name, '/', 1)))),
         (select n_files::text from _pre135)
  union all
  select 'b7 probes -- staff sees all, staff sees one, staff upload, bad shape refused, unknown PO refused, non-staff sees none, non-staff upload refused, staff delete, non-staff delete nothing',
         (select string_agg(result, ' | ' order by step) from _probe135),
         'sees 9 | sees 1 | allowed 1 | 42501 | 42501 | sees 0 | 42501 | allowed 1 | allowed 0'::text
  union all
  select 'b8 no public bucket left, public URLs no longer served',
         (select count(*)::text from storage.buckets where public),
         '0'::text
  union all
  select 'b9 order-pdfs and quote-pdfs untouched',
         (select string_agg(id || '=' || public::text, ',' order by id) from storage.buckets where id in ('order-pdfs', 'quote-pdfs')),
         'order-pdfs=false,quote-pdfs=false'::text
  union all
  select 'z0 verification ran, buckets = '
           || (select string_agg(id || '=' || public::text, ',' order by id) from storage.buckets),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
