-- 121r -- Reverse of 121. order_notes without notify_to.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- the route and the order page that read notify_to
-- fail once it is gone.
--
-- WHAT IT DOES.
--   1 A note whose notify_to holds exactly one address and whose assigned_to
--     is blank gets assigned_to = that address, so a note posted for one
--     person after 121 keeps its one assignee.
--   2 Drops order_notes_notify_to_check and the notify_to column. A list of
--     two or more people cannot fit in assigned_to and is lost -- a0 counts
--     those notes before anything changes.
-- No other column, no other row.
--
-- GUARDS, before any change.
--   notify_to exists (121 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'notify_to') <> 1 then
    raise exception 'order_notes.notify_to does not exist, so 121 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre121r on commit drop as
  select
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes where notify_to is not null)                         as n_listed,
    (select count(*) from vessl.order_notes where cardinality(notify_to) > 1)                    as n_multi,
    (select count(*) from vessl.order_notes
      where cardinality(notify_to) = 1 and assigned_to is null)                                  as n_copy,
    -- Every note without the two columns this touches.
    (select md5(coalesce(string_agg((to_jsonb(n) - 'notify_to' - 'assigned_to')::text, '/' order by n.id), ''))
       from vessl.order_notes n)                                                                 as h_rest;

update vessl.order_notes
   set assigned_to = notify_to[1]
 where cardinality(notify_to) = 1 and assigned_to is null;

alter table vessl.order_notes drop constraint order_notes_notify_to_check;
alter table vessl.order_notes drop column notify_to;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre121r)
           || ', with notify_to = ' || (select n_listed::text from _pre121r)
           || ', two or more people and lost = ' || (select n_multi::text from _pre121r)
           || ', one person copied to assigned_to = ' || (select n_copy::text from _pre121r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 notify_to is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'notify_to'),
         '0'::text
  union all
  select 'b2 the CHECK is gone',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_notify_to_check'),
         '0'::text
  union all
  select 'b3 every note unchanged apart from assigned_to',
         (select case when md5(coalesce(string_agg((to_jsonb(n) - 'assigned_to')::text, '/' order by n.id), ''))
                           = (select h_rest from _pre121r) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b4 same number of notes',
         (select count(*)::text from vessl.order_notes), (select n_notes::text from _pre121r)
  union all
  select 'z0 verification ran, notes with assigned_to = '
           || (select count(*)::text from vessl.order_notes where assigned_to is not null),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
