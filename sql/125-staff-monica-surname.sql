-- 125 -- Monica full_name reads Monica Harris, not Monica Smith.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 125r.
--
-- WHAT IT DOES. One column on one row. vessl.staff_profiles.full_name becomes
-- Monica Harris on the row script 124 inserted, which went in as Monica Smith.
-- No other column, no other row. Run as postgres, so the 110 staff guard
-- (which governs writes from the app) does not apply.
--
-- THE ROW. Identified by id and lengths, checked read-only on 19 Oct --
--   3ac9f7fb-22dc-4638-8d3f-d3deef15853b, email monica@kinguniversal.com
--   (length 24), full_name Monica Smith (length 12), role limited_ops
--
-- GUARDS, before any change.
--   exactly one row matches that id, email, email length 24, full_name Monica
--   Smith and full_name length 12
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the row before) and z0 (the row after),
-- on the rehearsal and again on the commit. Any b row is a failed check. Zero
-- rows means the query did not run.

begin;

create temp table _pre125 on commit drop as
  select
    (select count(*) from vessl.staff_profiles
      where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'
        and email = 'monica@kinguniversal.com' and length(email) = 24
        and full_name = 'Monica Smith' and length(full_name) = 12)                               as n_match,
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
  if (select n_match from _pre125) <> 1 then
    raise exception 'not exactly one row with that id, email and the name Monica Smith, nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles
   set full_name = 'Monica Harris'
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'
   and email = 'monica@kinguniversal.com' and length(email) = 24
   and full_name = 'Monica Smith' and length(full_name) = 12;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, full_name = ' || (select name_before from _pre125) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the row reads Monica Harris',
         (select coalesce(full_name, 'NULL')::text from vessl.staff_profiles
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'Monica Harris'::text
  union all
  select 'b2 every other column of the row unchanged',
         (select case when md5((to_jsonb(s) - 'full_name')::text) = (select h_row from _pre125) then 'same' else 'changed' end
            from vessl.staff_profiles s where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'::text
  union all
  select 'b3 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_others from _pre125) then 'same' else 'changed' end
            from vessl.staff_profiles s where id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'::text
  union all
  select 'b4 same number of staff rows',
         (select count(*)::text from vessl.staff_profiles), (select n_rows::text from _pre125)
  union all
  select 'z0 verification ran, after, full_name = '
           || (select coalesce(full_name, 'NULL') from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0, and z0 reads Monica Harris? Then swap these two lines.
-- commit;
rollback;
