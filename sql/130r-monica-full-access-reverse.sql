-- 130r -- Reverse 130. Monica Harris goes back to limited_ops.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 130. One transaction.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.role goes
-- from staff back to limited_ops on the row with id 3ac9f7fb-22dc-4638-8d3f-d3deef15853b.
-- Nothing else on her row and no other row is touched. Runs as postgres, which the
-- 109 and 110 guards let through. The limited_ops page list must still be in
-- app/page.jsx ROLE_PAGES, or the role reads as unrestricted.
--
-- GUARD. Exactly one row for the email, and her row reads staff, email length 24,
-- can_see_analytics false, which proves 130 ran and nothing has granted her
-- analytics since.
--
-- WHAT A PASS LOOKS LIKE. One row, z0. Any a or b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre130r on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select count(*) from vessl.staff_profiles where lower(email) = 'monica@kinguniversal.com') as n_match,
         (select role || '/' || length(email)::text || '/' || can_see_analytics::text
            from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica,
         (select md5((to_jsonb(sp) - 'role')::text) from vessl.staff_profiles sp
           where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as monica_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b') as others;

do $guard$
begin
  if (select n_match from _pre130r) <> 1 then
    raise exception 'not exactly one staff row for that email, so nothing changed';
  end if;
  if (select monica from _pre130r) is distinct from 'staff/24/false' then
    raise exception 'Monica row is not as 130 left it, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set role = 'limited_ops'
 where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b' and role = 'staff';

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, Monica staff, email length 24, no analytics' as chk,
         (select monica::text from _pre130r) as got,
         'staff/24/false' as want
  union all
  select 'b1 Monica is limited_ops again',
         (select role::text from vessl.staff_profiles where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'limited_ops'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'role')::text) = (select monica_rest from _pre130r) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre130r) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '3ac9f7fb-22dc-4638-8d3f-d3deef15853b'),
         'same'
  union all
  select 'b4 same number of staff rows',
         ((select count(*) from vessl.staff_profiles)::text), (select n_rows::text from _pre130r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
