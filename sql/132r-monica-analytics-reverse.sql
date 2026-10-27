-- 132r -- Reverse 132. Monica Harris no longer sees KUI Vessl Analytics.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 132. One transaction.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.can_see_analytics
-- goes from true back to false on the row with id 3ac9f7fb-22dc-4638-8d3f-d3deef15853b.
-- Nothing else on her row and no other row is touched. Runs as postgres, which the
-- 109 guard lets through.
--
-- GUARD. Exactly one row for the email, and her row reads email length 24 with
-- can_see_analytics true, which proves 132 ran.
--
-- WHAT A PASS LOOKS LIKE. One row, z0. Any a or b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre132r on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from vessl.staff_profiles where lower(email) = 'monica@kinguniversal.com') as n_match,
         (select length(email)::text || '/' || can_see_analytics::text
            from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica,
         (select md5((to_jsonb(sp) - 'can_see_analytics')::text) from vessl.staff_profiles sp
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as others;

do $guard$
begin
  if (select n_match from _pre132r) <> 1 then
    raise exception 'not exactly one staff row for that email, so nothing changed';
  end if;
  if (select monica from _pre132r) is distinct from '24/true' then
    raise exception 'Monica row is not as 132 left it, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set can_see_analytics = false
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b' and can_see_analytics = true;

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, Monica email length 24, analytics on' as chk,
         (select monica::text from _pre132r) as got,
         '24/true' as want
  union all
  select 'b1 Monica no longer sees analytics',
         (select can_see_analytics::text from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'false'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'can_see_analytics')::text) = (select monica_rest from _pre132r) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre132r) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b4 same number of staff rows',
         ((select count(*) from vessl.staff_profiles)::text), (select n_rows::text from _pre132r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
