-- 111r -- Reverse 111. Jenn Moore goes back to limited_qc.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 111. One transaction.
--
-- WHAT IT DOES. One update, one row, one column -- vessl.staff_profiles.role goes
-- from staff back to limited_qc on the row with id 7061815f-7791-4e1f-9bad-06ecdbdde9c1.
-- Nothing else on her row and no other row is touched. Runs as postgres, which the
-- 109 and 110 guards let through.
--
-- GUARD. Her row reads staff, email length 22, can_see_analytics false, which proves
-- 111 ran and nothing has granted her analytics since.
--
-- WHAT A PASS LOOKS LIKE. One row, z0. Any a or b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre111r on commit drop as
  select (select count(*) from vessl.staff_profiles) as n_rows,
         (select role || '/' || length(email)::text || '/' || can_see_analytics::text
            from vessl.staff_profiles where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as jenn,
         (select md5((to_jsonb(sp) - 'role')::text) from vessl.staff_profiles sp
           where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as jenn_rest,
         (select md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) from vessl.staff_profiles o
           where o.id <> '7061815f-7791-4e1f-9bad-06ecdbdde9c1') as others;

do $guard$
begin
  if (select jenn from _pre111r) is distinct from 'staff/22/false' then
    raise exception 'Jenn row is not as 111 left it, so nothing changed';
  end if;
end
$guard$;

update vessl.staff_profiles set role = 'limited_qc'
 where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1' and role = 'staff';

-- VERIFICATION. z0 alone is a pass. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, Jenn staff, email length 22, no analytics' as chk,
         (select jenn::text from _pre111r) as got,
         'staff/22/false' as want
  union all
  select 'b1 Jenn is limited_qc again',
         (select role::text from vessl.staff_profiles where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'limited_qc'
  union all
  select 'b2 every other column on her row unchanged',
         (select case when md5((to_jsonb(sp) - 'role')::text) = (select jenn_rest from _pre111r) then 'same' else 'changed' end
            from vessl.staff_profiles sp where id = '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'same'
  union all
  select 'b3 every other row unchanged',
         (select case when md5(string_agg(md5(to_jsonb(o)::text), ',' order by o.id)) = (select others from _pre111r) then 'same' else 'changed' end
            from vessl.staff_profiles o where o.id <> '7061815f-7791-4e1f-9bad-06ecdbdde9c1'),
         'same'
  union all
  select 'b4 same number of staff rows',
         ((select count(*) from vessl.staff_profiles)::text), (select n_rows::text from _pre111r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
