-- 99 -- PLM, the Revision checklist joins the Sampling checklist on each card.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 99r.
--
-- WHY. Revision folds into Sampling (1 Oct), so a card has one Sampling
-- checklist. The eight revision tasks on the board -- four on BUC-158, four on
-- ZZTESTPLM -- move into it, after the four sampling tasks each card already
-- has, in the order they were in.
--
-- WHAT IT DOES. One update, by id, on exactly the eight rows listed below.
-- stage goes from revision to sampling and sort_order goes up by 4, so the
-- revision tasks sit at 4 to 7 under the sampling ones at 0 to 3. Done,
-- blocker, due date, owner and text are untouched. updated_at is left alone,
-- because nobody edited a task. No task is added or deleted.
--
-- Measured on 1 Oct, after stage 4. No card is in Revision, no card note and no
-- round holds revision, so nothing else needs moving -- the guards check all
-- three, and stop rather than leave a revision row behind.
--
-- GUARDS, before any change.
--   exactly eight revision tasks on the board, and they are these eight ids,
--   each on its card at its old sort_order
--   the sampling tasks on BUC-158 and ZZTESTPLM end at sort_order 3, so the
--   moved ones land after them
--   no card, card note or round holds revision
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _ids99 (id uuid, program_id uuid, old_sort int) on commit drop;
insert into _ids99 values
  ('847b25c5-9ffe-46d7-9d8e-f9724570ddb9'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 0),
  ('4f75317b-f908-4557-80c5-39eac03451a3'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 1),
  ('807ded8b-cad9-425f-bc96-6aad1ba328c2'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 2),
  ('f2c33021-ceb2-4cfe-b327-cd92b8f89bfa'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 3),
  ('0221b87b-992a-4c69-a8b8-40f44f798565'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 0),
  ('abb17d4d-fcf1-420a-82c9-b4e4051d9196'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 1),
  ('15f721b2-29f7-4ce5-ab64-6df65c7a2c08'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 2),
  ('6b3e25d3-9fbd-4a72-9f4d-2e074dc2712d'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 3);

create temp table _pre99 on commit drop as
  select
    (select count(*) from vessl.program_tasks where stage = 'revision')                          as n_rev_tasks,
    (select count(*) from vessl.program_tasks t join _ids99 i
        on i.id = t.id and i.program_id = t.program_id and i.old_sort = t.sort_order
      where t.stage = 'revision')                                                                as n_matched,
    (select coalesce(max(sort_order), -1) from vessl.program_tasks
      where stage = 'sampling' and program_id = '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid)     as max_buc,
    (select coalesce(max(sort_order), -1) from vessl.program_tasks
      where stage = 'sampling' and program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)     as max_zz,
    (select count(*) from vessl.programs where declared_stage = 'revision')
      + (select count(*) from vessl.program_notes where stage = 'revision')
      + (select count(*) from vessl.program_sample_rounds where stage = 'revision')              as n_rev_other,
    (select count(*) from vessl.program_tasks)                                                   as t_tasks,
    -- The eight, every column but stage and sort_order.
    (select md5(string_agg((to_jsonb(t) - 'stage' - 'sort_order')::text, '/' order by t.id))
       from vessl.program_tasks t where t.id in (select id from _ids99))                         as h_eight,
    -- Every other task, whole.
    (select md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
       from vessl.program_tasks t where t.id not in (select id from _ids99))                     as h_others;

do $guard$
begin
  if (select n_rev_tasks from _pre99) <> 8 or (select n_matched from _pre99) <> 8 then
    raise exception 'the revision tasks are not the eight measured on 1 Oct -- found %, matched %, nothing changed',
      (select n_rev_tasks from _pre99), (select n_matched from _pre99);
  end if;
  if (select max_buc from _pre99) <> 3 or (select max_zz from _pre99) <> 3 then
    raise exception 'the sampling tasks on BUC-158 or ZZTESTPLM do not end at 3, nothing changed';
  end if;
  if (select n_rev_other from _pre99) <> 0 then
    raise exception 'a card, card note or round holds revision, nothing changed';
  end if;
end
$guard$;

update vessl.program_tasks t
   set stage = 'sampling', sort_order = t.sort_order + 4
  from _ids99 i
 where t.id = i.id and t.stage = 'revision' and t.sort_order = i.old_sort;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 eight revision tasks matched by id, sampling ends at 3 on both cards, no other revision rows' as chk,
         (select n_rev_tasks::text || '/' || n_matched::text || '/' || max_buc::text || '/' || max_zz::text
                 || '/' || n_rev_other::text from _pre99) as got,
         '8/8/3/3/0' as want
  union all
  select 'b1 the eight are sampling now, each at its old place plus 4',
         (select count(*)::text from vessl.program_tasks t join _ids99 i on i.id = t.id
           where t.stage = 'sampling' and t.sort_order = i.old_sort + 4 and t.program_id = i.program_id),
         '8'
  union all
  select 'b2 no task anywhere is revision now',
         (select count(*)::text from vessl.program_tasks where stage = 'revision'), '0'
  union all
  select 'b3 each card now has one sampling list, 0 to 7 -- BUC-158 then ZZTESTPLM',
         (select string_agg(x, ' / ' order by x) from (
            select string_agg(sort_order::text, ',' order by sort_order) as x
              from vessl.program_tasks
             where stage = 'sampling'
               and program_id in ('7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)
             group by program_id) s),
         '0,1,2,3,4,5,6,7 / 0,1,2,3,4,5,6,7'
  union all
  select 'b4 the eight kept done, blocker, due date, owner, text and updated_at',
         (select md5(string_agg((to_jsonb(t) - 'stage' - 'sort_order')::text, '/' order by t.id))
            from vessl.program_tasks t where t.id in (select id from _ids99)),
         (select h_eight from _pre99)
  union all
  select 'b5 every other task unchanged, and the same number of tasks',
         (select md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
            from vessl.program_tasks t where t.id not in (select id from _ids99))
         || '/' || (select count(*)::text from vessl.program_tasks),
         (select h_others || '/' || t_tasks::text from _pre99)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
