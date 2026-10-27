-- 96 -- PLM, allow the stage archived on cards, card notes and checklist tasks.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 96r.
--
-- WHY. The 1 Oct simplification makes the visible flow Quoting, Sampling,
-- Archived, and Archived is a real stage -- a third column -- not the Remove from
-- board flag (option B). Three CHECKs list the stages a row may hold.
--   programs.declared_stage       -- the card stage, NULL allowed
--   program_notes.stage           -- the stage a Card Note was written in, NULL allowed
--   program_tasks.stage           -- the stage a checklist task belongs to, NOT NULL
-- Tasks need it too. Nothing seeds an Archived checklist, but a task somebody
-- adds by hand on an archived card is written with the card stage.
--
-- WHAT IT DOES. Each CHECK is dropped and added again under the same name with
-- archived appended. The six old values all stay allowed, so Revision, Testing,
-- Production and Shipped can come back without a schema change. No row is
-- written. Adding a CHECK validates every existing row, and none can fail,
-- because the new list is the old list plus one.
--
-- GUARDS, before any change.
--   each of the three CHECKs exists and its definition hashes to the value
--   measured on 1 Oct, so this never replaces a CHECK somebody changed since
--   no row anywhere already holds archived
--   the ZZTESTPLM card and one of its tasks exist by id -- the probes use them
--
-- PROBES, after the change. Each runs in its own sub-block that always undoes
-- itself, so nothing they write survives even on commit.
--   p1 the ZZTESTPLM card can be set to archived
--   p2 one of its tasks can be set to archived
--   p3 a card note can be written with stage archived
--   p4 a value outside the list is still refused
--
-- WHAT A PASS LOOKS LIKE. r1 always shows the three new definition hashes, for
-- the record. Then z0. Any a or b row is a failed check.

begin;

create temp table _pre96 on commit drop as
  select
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.programs'::regclass and conname = 'programs_declared_stage_check')       as h_prog,
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.program_notes'::regclass and conname = 'program_notes_stage_check')      as h_notes,
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.program_tasks'::regclass and conname = 'program_tasks_stage_check')      as h_tasks,
    (select count(*) from vessl.programs where declared_stage = 'archived')
      + (select count(*) from vessl.program_notes where stage = 'archived')
      + (select count(*) from vessl.program_tasks where stage = 'archived')                            as n_archived,
    (select count(*) from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)
      || '/' || (select count(*) from vessl.program_tasks
                  where id = '0221b87b-992a-4c69-a8b8-40f44f798565'::uuid
                    and program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)                     as probe_rows,
    (select count(*) from vessl.programs)                                                              as t_prog,
    (select count(*) from vessl.program_notes)                                                         as t_notes,
    (select count(*) from vessl.program_tasks)                                                         as t_tasks;

do $guard$
begin
  if (select h_prog from _pre96) is distinct from '3c08d115157ea7747a0cf4b5a3a16e69'
     or (select h_notes from _pre96) is distinct from 'da2d078629f7053f6b36bf9cfc43bc7a'
     or (select h_tasks from _pre96) is distinct from '41d9b0d2685207ffa70a78eb39dd5513' then
    raise exception 'a stage CHECK is not the one measured on 1 Oct, nothing changed';
  end if;
  if (select n_archived from _pre96) <> 0 then
    raise exception 'a row already holds archived, nothing changed';
  end if;
  if (select probe_rows from _pre96) is distinct from '1/1' then
    raise exception 'the ZZTESTPLM card or its task is missing, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs drop constraint programs_declared_stage_check;
alter table vessl.programs add constraint programs_declared_stage_check
  check (declared_stage is null or declared_stage = any (array['quoted', 'sampling', 'revision', 'testing',
                                                               'production', 'shipped', 'archived']));

alter table vessl.program_notes drop constraint program_notes_stage_check;
alter table vessl.program_notes add constraint program_notes_stage_check
  check (stage is null or stage = any (array['quoted', 'sampling', 'revision', 'testing',
                                             'production', 'shipped', 'archived']));

alter table vessl.program_tasks drop constraint program_tasks_stage_check;
alter table vessl.program_tasks add constraint program_tasks_stage_check
  check (stage = any (array['quoted', 'sampling', 'revision', 'testing',
                            'production', 'shipped', 'archived']));

-- PROBES. Each sub-block ends by raising, which undoes its write; the handler
-- records what happened. A check_violation means the CHECK refused the value.
create temp table _probe96 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
begin
  begin
    update vessl.programs set declared_stage = 'archived'
     where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96 values (1, 'refused');
    when raise_exception then insert into _probe96 select 1, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    update vessl.program_tasks set stage = 'archived'
     where id = '0221b87b-992a-4c69-a8b8-40f44f798565'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96 values (2, 'refused');
    when raise_exception then insert into _probe96 select 2, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    insert into vessl.program_notes (program_id, author, source, note, stage)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'probe', 'probe 96', 'archived');
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96 values (3, 'refused');
    when raise_exception then insert into _probe96 select 3, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    update vessl.programs set declared_stage = 'notastage'
     where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96 values (4, 'refused');
    when raise_exception then insert into _probe96 select 4, case when n = 1 then 'accepted' else 'norow' end;
  end;
end
$probe$;

-- VERIFICATION. r1 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r1 new definition hashes -- programs, notes, tasks' as chk,
         ((select md5(pg_get_constraintdef(oid)) from pg_constraint
            where conrelid = 'vessl.programs'::regclass and conname = 'programs_declared_stage_check')
          || ' / ' || (select md5(pg_get_constraintdef(oid)) from pg_constraint
            where conrelid = 'vessl.program_notes'::regclass and conname = 'program_notes_stage_check')
          || ' / ' || (select md5(pg_get_constraintdef(oid)) from pg_constraint
            where conrelid = 'vessl.program_tasks'::regclass and conname = 'program_tasks_stage_check'))::text as got,
         'shown every run' as want
  union all
  select 'a0 the three CHECKs were the 1 Oct ones, no archived rows, probe rows present',
         (select (h_prog = '3c08d115157ea7747a0cf4b5a3a16e69')::text || '/'
                 || (h_notes = 'da2d078629f7053f6b36bf9cfc43bc7a')::text || '/'
                 || (h_tasks = '41d9b0d2685207ffa70a78eb39dd5513')::text || '/'
                 || n_archived::text || '/' || probe_rows from _pre96),
         'true/true/true/0/1/1'
  union all
  select 'b1 each CHECK exists once and is validated',
         (select count(*)::text || '/' || bool_and(convalidated)::text from pg_constraint
           where (conrelid = 'vessl.programs'::regclass and conname = 'programs_declared_stage_check')
              or (conrelid = 'vessl.program_notes'::regclass and conname = 'program_notes_stage_check')
              or (conrelid = 'vessl.program_tasks'::regclass and conname = 'program_tasks_stage_check')),
         '3/true'
  union all
  select 'b2 probes -- card, task and note accept archived, a junk value is refused',
         (select string_agg(result, '/' order by step) from _probe96), 'ok/ok/ok/refused'
  union all
  select 'b3 the probes left nothing -- no archived rows, row counts unchanged',
         (select ((select count(*) from vessl.programs where declared_stage = 'archived')
                + (select count(*) from vessl.program_notes where stage = 'archived')
                + (select count(*) from vessl.program_tasks where stage = 'archived'))::text
                 || '/' || ((select count(*) from vessl.programs) - t_prog)::text
                 || '/' || ((select count(*) from vessl.program_notes) - t_notes)::text
                 || '/' || ((select count(*) from vessl.program_tasks) - t_tasks)::text
            from _pre96), '0/0/0/0'
  union all
  select 'b4 the probe rows are as they were -- ZZTESTPLM and its task both still revision',
         (select (select declared_stage from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)
                 || '/' || (select stage from vessl.program_tasks where id = '0221b87b-992a-4c69-a8b8-40f44f798565'::uuid)),
         'revision/revision'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
