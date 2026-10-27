-- 129r -- Reverse of 129. Drops quotes.pdf_path, both quote-pdfs policies and
-- the quote-pdfs bucket.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- Take the code out first -- the quote form uploads to this bucket.
--
-- THE BUCKET MUST BE EMPTY. Stored PDFs are files as well as rows, and
-- deleting the rows here would orphan the files. Remove them in the Supabase
-- dashboard (Storage, quote-pdfs) first; the guard refuses while any remain.
--
-- WHAT IS LOST. Every pdf_path on a quote (a0 counts them). The PDFs
-- themselves are already gone by then, per the paragraph above.
--
-- GUARDS, before any change.
--   the bucket, both policies and the column exist (129 has run)
--   the bucket holds no objects
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on
-- the commit. Any b row is a failed check. Zero rows means the query did not
-- run.

begin;

create temp table _pre129r on commit drop as
  select
    (select count(*) from storage.buckets where id = 'quote-pdfs')                               as has_bucket,
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('quote-pdfs staff read', 'quote-pdfs staff upload'))                   as n_pol,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_path')       as has_col,
    (select count(*) from storage.objects where bucket_id = 'quote-pdfs')                        as n_objects,
    (select count(*) from vessl.quotes where pdf_path is not null)                              as n_paths,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')   as n_obj_pol;

do $guard$
begin
  if (select has_bucket from _pre129r) <> 1 or (select n_pol from _pre129r) <> 2 or (select has_col from _pre129r) <> 1 then
    raise exception 'the bucket, a policy or the column is missing, so 129 was not committed, nothing changed';
  end if;
  if (select n_objects from _pre129r) <> 0 then
    raise exception 'quote-pdfs still holds files, remove them in the dashboard first, nothing changed';
  end if;
end
$guard$;

drop policy "quote-pdfs staff read" on storage.objects;
drop policy "quote-pdfs staff upload" on storage.objects;

-- Supabase blocks direct deletes from storage tables unless this is set; it
-- lasts to the end of this transaction only.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id = 'quote-pdfs';

alter table vessl.quotes drop column pdf_path;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, quotes with a pdf_path (lost) = ' || (select n_paths::text from _pre129r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 bucket gone',
         (select count(*)::text from storage.buckets where id = 'quote-pdfs'),
         '0'::text
  union all
  select 'b2 both policies gone, the rest untouched',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'),
         (select (n_obj_pol - 2)::text from _pre129r)
  union all
  select 'b3 pdf_path gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_path'),
         '0'::text
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
