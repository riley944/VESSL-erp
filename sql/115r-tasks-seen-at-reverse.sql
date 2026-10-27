-- 115r -- Reverse 115. seen_at is dropped from vessl.tasks.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 115. One transaction.
--
-- WHAT IT DOES. Drops seen_at. Every read mark recorded since 115 is LOST -- a0
-- shows how many tasks hold one, so read it on the rehearsal before swapping to
-- commit. Every other column, row and grant stays.
--
-- THE CODE FIRST. The task lists name seen_at when they mark a task read. Take
-- that code out first so a click on a task is not refused.
--
-- GUARD. seen_at exists.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0. Any b row is a failed check. Zero
-- rows means the query did not run. a0 always shows, with how many tasks lose a mark.

begin;

create temp table _pre115r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'tasks'
        and column_name = 'seen_at')                                                             as has_col,
    (select count(*) from vessl.tasks)                                                           as n_tasks;

do $guard$
begin
  if (select has_col from _pre115r) <> 1 then
    raise exception 'seen_at is missing, so 115 is not as it left things, nothing changed';
  end if;
end
$guard$;

-- How many tasks hold a read mark, read before the column goes.
create temp table _lost115r on commit drop as
  select count(*) as n_set from vessl.tasks where seen_at is not null;

-- Every task, every column but seen_at, so b2 can prove nothing else moved.
create temp table _rest115r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(t) - 'seen_at')::text, '/' order by t.id), '')) as h_rest
    from vessl.tasks t;

alter table vessl.tasks drop column seen_at;

-- VERIFICATION. a0 (always shown, with the count) and z0 are a pass. Any b row is a
-- failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, seen_at present; tasks losing a read mark = '
           || (select n_set::text from _lost115r) as chk,
         (select has_col::text from _pre115r) as got,
         '1' as want
  union all
  select 'b1 seen_at is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'tasks' and column_name = 'seen_at'),
         '0'
  union all
  select 'b2 every other column on every task unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
                           = (select h_rest from _rest115r) then 'same' else 'changed' end
            from vessl.tasks t),
         'same'
  union all
  select 'b3 same number of tasks',
         ((select count(*) from vessl.tasks)::text), (select n_tasks::text from _pre115r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk like 'a0%'
   or chk = 'z0 verification ran'
order by chk;

-- Two rows, a0 and z0, and the count is what you expect? Then swap these two lines.
-- commit;
rollback;
