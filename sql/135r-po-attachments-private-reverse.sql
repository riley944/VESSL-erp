-- 135r -- Reverse of 135. po-attachments goes back to public, no limits, and
-- the three old any-signed-in-user policies, recreated as they were.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- The code does not need to come out first; signed links work on a public
-- bucket as well.
--
-- WHAT IS LOST. Nothing stored. Files stay where they are (a0 counts them).
-- What comes back is the exposure 135 removed -- every file readable by its
-- public URL without signing in, and any signed-in user, staff or not, able to
-- read, upload and delete in the bucket.
--
-- THE OLD POLICIES, as measured on 26 Oct before 135, all PERMISSIVE, all to
-- authenticated, each on bucket_id alone (expression length 36).
--   auth read po-attachments      SELECT  using
--   auth upload po-attachments    INSERT  with check
--   auth delete po-attachments    DELETE  using
--
-- GUARDS, before any change.
--   bucket po-attachments exists and is private (135 has run)
--   all three new staff policies exist
--   none of the three old policy names exists
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on
-- the commit. Any b row is a failed check. Zero rows means the query did not
-- run.

begin;

create temp table _pre135r on commit drop as
  select
    (select count(*) from storage.buckets where id = 'po-attachments' and not public)                      as bucket_private,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('po-attachments staff read', 'po-attachments staff upload', 'po-attachments staff delete')) as n_new,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('auth read po-attachments', 'auth upload po-attachments', 'auth delete po-attachments')) as n_old,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')               as n_obj_pol,
    (select count(*) from storage.objects where bucket_id = 'po-attachments')                                as n_files,
    (select count(*) from storage.objects)                                                                   as n_objects;

do $guard$
begin
  if (select bucket_private from _pre135r) <> 1 or (select n_new from _pre135r) <> 3 then
    raise exception 'the bucket is not private or a staff policy is missing, so 135 was not committed, nothing changed';
  end if;
  if (select n_old from _pre135r) <> 0 then
    raise exception 'an old auth po-attachments policy already exists, nothing changed';
  end if;
end
$guard$;

update storage.buckets
   set public = true,
       file_size_limit = null,
       allowed_mime_types = null
 where id = 'po-attachments';

drop policy "po-attachments staff read" on storage.objects;
drop policy "po-attachments staff upload" on storage.objects;
drop policy "po-attachments staff delete" on storage.objects;

create policy "auth read po-attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'po-attachments');

create policy "auth upload po-attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'po-attachments');

create policy "auth delete po-attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'po-attachments');

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, po-attachments files = ' || (select n_files::text from _pre135r)
           || ', storage policies = ' || (select n_obj_pol::text from _pre135r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 bucket po-attachments public, no limit, any type',
         (select public::text || '/' || coalesce(file_size_limit::text, 'none') || '/' || coalesce(array_to_string(allowed_mime_types, ','), 'none')
            from storage.buckets where id = 'po-attachments')::text,
         'true/none/none'::text
  union all
  select 'b2 the three old policies back, permissive, for authenticated, expression length 36',
         (select string_agg(policyname || '=' || cmd || '=' || permissive || '=' || array_to_string(roles, ',')
                            || '=' || length(coalesce(qual, with_check))::text, ' | ' order by policyname)
            from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('auth read po-attachments', 'auth upload po-attachments', 'auth delete po-attachments')),
         'auth delete po-attachments=DELETE=PERMISSIVE=authenticated=36 | auth read po-attachments=SELECT=PERMISSIVE=authenticated=36 | auth upload po-attachments=INSERT=PERMISSIVE=authenticated=36'::text
  union all
  select 'b3 upload checks with check only, read and delete using only',
         (select string_agg(policyname || '=' || (qual is not null)::text || '/' || (with_check is not null)::text, ' | ' order by policyname)
            from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('auth read po-attachments', 'auth upload po-attachments', 'auth delete po-attachments')),
         'auth delete po-attachments=true/false | auth read po-attachments=true/false | auth upload po-attachments=false/true'::text
  union all
  select 'b4 the three staff policies gone, the rest untouched',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'),
         (select n_obj_pol::text from _pre135r)
  union all
  select 'b5 no file touched',
         (select count(*)::text from storage.objects where bucket_id = 'po-attachments') || '/' || (select count(*)::text from storage.objects),
         (select n_files::text || '/' || n_objects::text from _pre135r)
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
