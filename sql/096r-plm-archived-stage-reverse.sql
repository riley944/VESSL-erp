-- 96r -- Reverse 96. Put the three stage CHECKs back to the six stages, without archived.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 96. One transaction.
--
-- WHAT IT DOES. Drops and re-adds programs_declared_stage_check,
-- program_notes_stage_check and program_tasks_stage_check with the six values
-- they held before 96. No row is written.
--
-- GUARDS, before any change.
--   no card, card note or task holds archived. If one does, the CHECK could not
--   be added back, and the right move is to take that card off Archived first --
--   so this stops and names the counts rather than rewriting anybody stage
--   all three CHECKs exist and none still hashes to its pre-96 value, which
--   proves 96 ran and this is not a second reverse
--
-- AFTER. a0 records the guard inputs. b1 is the strong check -- each definition
-- hashes to exactly the value measured on 1 Oct, before 96, so the CHECKs are
-- byte-for-byte what they were. b2 probes that archived is refused again, each
-- probe undone as in 96.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre96r on commit drop as
  select
    (select count(*) from vessl.programs where declared_stage = 'archived')                            as n_prog,
    (select count(*) from vessl.program_notes where stage = 'archived')                                as n_notes,
    (select count(*) from vessl.program_tasks where stage = 'archived')                                as n_tasks,
    (select count(*) from pg_constraint
      where (conrelid = 'vessl.programs'::regclass and conname = 'programs_declared_stage_check'
             and md5(pg_get_constraintdef(oid)) <> '3c08d115157ea7747a0cf4b5a3a16e69')
         or (conrelid = 'vessl.program_notes'::regclass and conname = 'program_notes_stage_check'
             and md5(pg_get_constraintdef(oid)) <> 'da2d078629f7053f6b36bf9cfc43bc7a')
         or (conrelid = 'vessl.program_tasks'::regclass and conname = 'program_tasks_stage_check'
             and md5(pg_get_constraintdef(oid)) <> '41d9b0d2685207ffa70a78eb39dd5513'))               as n_changed;

do $guard$
begin
  if (select n_prog + n_notes + n_tasks from _pre96r) <> 0 then
    raise exception 'rows still hold archived -- cards %, notes %, tasks % -- move them off Archived first, nothing changed',
      (select n_prog from _pre96r), (select n_notes from _pre96r), (select n_tasks from _pre96r);
  end if;
  if (select n_changed from _pre96r) <> 3 then
    raise exception 'expected all three CHECKs to be the 96 versions, found % -- nothing changed',
      (select n_changed from _pre96r);
  end if;
end
$guard$;

alter table vessl.programs drop constraint programs_declared_stage_check;
alter table vessl.programs add constraint programs_declared_stage_check
  check (declared_stage is null or declared_stage = any (array['quoted', 'sampling', 'revision', 'testing',
                                                               'production', 'shipped']));

alter table vessl.program_notes drop constraint program_notes_stage_check;
alter table vessl.program_notes add constraint program_notes_stage_check
  check (stage is null or stage = any (array['quoted', 'sampling', 'revision', 'testing',
                                             'production', 'shipped']));

alter table vessl.program_tasks drop constraint program_tasks_stage_check;
alter table vessl.program_tasks add constraint program_tasks_stage_check
  check (stage = any (array['quoted', 'sampling', 'revision', 'testing',
                            'production', 'shipped']));

create temp table _probe96r (step int, result text) on commit drop;

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
    when check_violation then insert into _probe96r values (1, 'refused');
    when raise_exception then insert into _probe96r select 1, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    update vessl.program_tasks set stage = 'archived'
     where id = '0221b87b-992a-4c69-a8b8-40f44f798565'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96r values (2, 'refused');
    when raise_exception then insert into _probe96r select 2, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    insert into vessl.program_notes (program_id, author, source, note, stage)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'probe', 'probe 96r', 'archived');
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe96r values (3, 'refused');
    when raise_exception then insert into _probe96r select 3, case when n = 1 then 'accepted' else 'norow' end;
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 no archived rows, all three CHECKs were the 96 versions' as chk,
         (select (n_prog + n_notes + n_tasks)::text || '/' || n_changed::text from _pre96r) as got,
         '0/3' as want
  union all
  select 'b1 each CHECK hashes to its pre-96 value -- programs, notes, tasks',
         (select string_agg((md5(pg_get_constraintdef(c.oid)) = x.h)::text, '/' order by x.ord)
            from pg_constraint c
            join (values (1, 'vessl.programs'::regclass, 'programs_declared_stage_check', '3c08d115157ea7747a0cf4b5a3a16e69'),
                         (2, 'vessl.program_notes'::regclass, 'program_notes_stage_check', 'da2d078629f7053f6b36bf9cfc43bc7a'),
                         (3, 'vessl.program_tasks'::regclass, 'program_tasks_stage_check', '41d9b0d2685207ffa70a78eb39dd5513'))
                 as x(ord, rel, name, h)
              on c.conrelid = x.rel and c.conname = x.name),
         'true/true/true'
  union all
  select 'b2 probes -- card, task and note refuse archived again',
         (select string_agg(result, '/' order by step) from _probe96r), 'refused/refused/refused'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
