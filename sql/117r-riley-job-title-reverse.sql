-- 117r -- Reverse 117. Riley job title back to NULL, only if it still reads VP of Sales.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 117. One transaction.
--
-- WHAT IT DOES. Clears vessl.staff_profiles.job_title on Riley row ONLY WHERE IT
-- STILL READS VP of Sales. If he has since typed another title, nothing changes
-- and a0 and z0 both show it. No other row, no other column.
--
-- THE ROW. As in 117 -- 11da4231-8e38-483e-8dd0-882db902dc30, email length 23.
--
-- GUARD. job_title exists, and exactly one row matches that id and email length.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the row before) and z0 (the row after).
-- Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre117r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'staff_profiles' and column_name = 'job_title')   as has_col,
    (select count(*) from vessl.staff_profiles
      where id = '11da4231-8e38-483e-8dd0-882db902dc30' and length(email) = 23)                       as n_match,
    (select count(*) from vessl.staff_profiles)                                                          as n_rows,
    (select coalesce(job_title, 'NULL') from vessl.staff_profiles
      where id = '11da4231-8e38-483e-8dd0-882db902dc30')                                               as title_before,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s where id <> '11da4231-8e38-483e-8dd0-882db902dc30')                  as h_others,
    (select md5((to_jsonb(s) - 'job_title')::text)
       from vessl.staff_profiles s where id = '11da4231-8e38-483e-8dd0-882db902dc30')                   as h_row;

do $guard$
begin
  if (select has_col from _pre117r) <> 1 then
    raise exception 'staff_profiles.job_title is missing, nothing changed';
  end if;
  if (select n_match from _pre117r) <> 1 then
    raise exception 'not exactly one staff row matches Riley id and email length, nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles
   set job_title = null
 where id = '11da4231-8e38-483e-8dd0-882db902dc30' and length(email) = 23
   and job_title = 'VP of Sales';

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, Riley job_title = ' || (select title_before from _pre117r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 Riley title is NULL if it read VP of Sales, else unchanged',
         (select coalesce(job_title, 'NULL')::text from vessl.staff_profiles where id = '11da4231-8e38-483e-8dd0-882db902dc30'),
         (select case when title_before = 'VP of Sales' then 'NULL' else title_before end from _pre117r)
  union all
  select 'b2 every other column of Riley row unchanged',
         (select case when md5((to_jsonb(s) - 'job_title')::text) = (select h_row from _pre117r) then 'same' else 'changed' end
            from vessl.staff_profiles s where id = '11da4231-8e38-483e-8dd0-882db902dc30'),
         'same'
  union all
  select 'b3 every other staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_others from _pre117r) then 'same' else 'changed' end
            from vessl.staff_profiles s where id <> '11da4231-8e38-483e-8dd0-882db902dc30'),
         'same'
  union all
  select 'b4 same number of staff rows',
         (select count(*)::text from vessl.staff_profiles), (select n_rows::text from _pre117r)
  union all
  select 'z0 verification ran, after, Riley job_title = '
           || (select coalesce(job_title, 'NULL') from vessl.staff_profiles where id = '11da4231-8e38-483e-8dd0-882db902dc30'),
         'shown', 'always'
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0, and z0 is what you expect? Then swap these two lines.
-- commit;
rollback;
