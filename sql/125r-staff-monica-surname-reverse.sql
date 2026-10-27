-- 125r -- Reverse of 125. Monica full_name back to Monica Smith.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. One column on one row. vessl.staff_profiles.full_name goes
-- back to Monica Smith, the name script 124 inserted, but only while it still
-- reads Monica Harris -- a name changed since is left alone.
-- No other column, no other row. Run as postgres, so the 110 staff guard
-- (which governs writes from the app) does not apply.
--
-- THE ROW. Identified by id and lengths, as in 125 --
--   3ac9f7fb-22dc-4638-8d3f-d3deef15853b, email monica@kinguniversal.com
--   (length 24), full_name Monica Harris (length 13) after 125
--
-- GUARDS, before any change.
--   exactly one row matches that id, email, email length 24, full_name Monica
--   Harris and full_name length 13
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the row before) and z0 (the row after),
-- on the rehearsal and again on the commit. Any b row is a failed check. Zero
-- rows means the query did not run.

begin;

create temp table _pre125r on commit drop as
  select
    (select count(*) from vessl.staff_profiles
      where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'
        and email = 'monica@kinguniversal.com' and length(email) = 24
        and full_name = 'Monica Harris' and length(full_name) = 13)                               as n_match,
    (select count(*) from vessl.staff_profiles)                                                  as n_rows,
    (select coalesce(full_name, 'NULL') from vessl.staff_profiles
      where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b')                                         as name_before,
    -- Every other row, every column; and this row without full_name.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s where id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b')           as h_others,
    (select md5((to_jsonb(s) - 'full_name')::text)
       from vessl.staff_profiles s where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b')            as h_row;

do $guard$
begin
  if (select n_match from _pre125r) <> 1 then
    raise exception 'not exactly one row with that id, email and the name Monica Harris, nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles
   set full_name = 'Monica Smith'
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'
   and email = 'monica@kinguniversal.com' and length(email) = 24
   and full_name = 'Monica Harris' and length(full_name) = 13;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, full_name = ' || (select name_before from _pre125r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the row reads Monica Smith',
         (select coalesce(full_name, 'NULL')::text from vessl.staff_profiles
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'Monica Smith'::text
  union all
  select 'b2 every other column of the row unchanged',
         (select case when md5((to_jsonb(s) - 'full_name')::text) = (select h_row from _pre125r) then 'same' else 'changed' end
            from vessl.staff_profiles s where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'::text
  union all
  select 'b3 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_others from _pre125r) then 'same' else 'changed' end
            from vessl.staff_profiles s where id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'::text
  union all
  select 'b4 same number of staff rows',
         (select count(*)::text from vessl.staff_profiles), (select n_rows::text from _pre125r)
  union all
  select 'z0 verification ran, after, full_name = '
           || (select coalesce(full_name, 'NULL') from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0, and z0 reads Monica Smith? Then swap these two lines.
-- commit;
rollback;
