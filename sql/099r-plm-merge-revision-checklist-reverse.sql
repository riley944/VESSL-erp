-- 99r -- Reverse 99. The eight tasks 99 moved go back to the Revision checklist.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 99. One transaction.
--
-- WHAT IT DOES. One update, by id, on the same eight rows 99 moved, and only
-- those -- stage back to revision, sort_order back down by 4. A task somebody
-- added to the Sampling checklist after 99 is not touched, nor is any edit made
-- to the eight since (done, blocker, due date, owner, text).
--
-- GUARDS, before any change.
--   all eight exist, are sampling, and sit at their old place plus 4 on their
--   own card. If any was deleted or moved since, this stops and says how many
--   matched, rather than reversing part of the merge.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _ids99r (id uuid, program_id uuid, old_sort int) on commit drop;
insert into _ids99r values
  ('847b25c5-9ffe-46d7-9d8e-f9724570ddb9'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 0),
  ('4f75317b-f908-4557-80c5-39eac03451a3'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 1),
  ('807ded8b-cad9-425f-bc96-6aad1ba328c2'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 2),
  ('f2c33021-ceb2-4cfe-b327-cd92b8f89bfa'::uuid, '7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 3),
  ('0221b87b-992a-4c69-a8b8-40f44f798565'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 0),
  ('abb17d4d-fcf1-420a-82c9-b4e4051d9196'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 1),
  ('15f721b2-29f7-4ce5-ab64-6df65c7a2c08'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 2),
  ('6b3e25d3-9fbd-4a72-9f4d-2e074dc2712d'::uuid, '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 3);

create temp table _pre99r on commit drop as
  select
    (select count(*) from vessl.program_tasks t join _ids99r i
        on i.id = t.id and i.program_id = t.program_id and t.sort_order = i.old_sort + 4
      where t.stage = 'sampling')                                                                as n_matched,
    (select count(*) from vessl.program_tasks)                                                   as t_tasks,
    (select md5(string_agg((to_jsonb(t) - 'stage' - 'sort_order')::text, '/' order by t.id))
       from vessl.program_tasks t where t.id in (select id from _ids99r))                        as h_eight,
    (select md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
       from vessl.program_tasks t where t.id not in (select id from _ids99r))                    as h_others;

do $guard$
begin
  if (select n_matched from _pre99r) <> 8 then
    raise exception 'only % of the eight are where 99 left them, nothing changed', (select n_matched from _pre99r);
  end if;
end
$guard$;

update vessl.program_tasks t
   set stage = 'revision', sort_order = t.sort_order - 4
  from _ids99r i
 where t.id = i.id and t.stage = 'sampling' and t.sort_order = i.old_sort + 4;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 all eight were where 99 left them' as chk,
         (select n_matched::text from _pre99r) as got,
         '8' as want
  union all
  select 'b1 the eight are revision again, at their old place',
         (select count(*)::text from vessl.program_tasks t join _ids99r i on i.id = t.id
           where t.stage = 'revision' and t.sort_order = i.old_sort and t.program_id = i.program_id),
         '8'
  union all
  select 'b2 the eight kept everything else',
         (select md5(string_agg((to_jsonb(t) - 'stage' - 'sort_order')::text, '/' order by t.id))
            from vessl.program_tasks t where t.id in (select id from _ids99r)),
         (select h_eight from _pre99r)
  union all
  select 'b3 every other task unchanged, and the same number of tasks',
         (select md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
            from vessl.program_tasks t where t.id not in (select id from _ids99r))
         || '/' || (select count(*)::text from vessl.program_tasks),
         (select h_others || '/' || t_tasks::text from _pre99r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
