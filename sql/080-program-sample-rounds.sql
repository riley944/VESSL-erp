-- 80 -- Sample rounds become saved entries, vessl.program_sample_rounds.
--
-- WHAT IT DOES. Creates one table holding the sample rounds saved on a PLM card,
-- one row per round, and backfills a single row -- round 1 on the ZZTESTPLM card,
-- copied from its strip. The four programs columns from script 77 are NOT
-- touched. They stay in place, and after the code ships nothing writes or reads
-- them. A later script can drop them once the table has proven itself.
--
-- THE RULES THE TABLE HOLDS ITSELF
--   unique (program_id, round) -- one round 1 per card, and two people cannot
--   both save the same round number, whatever the screen showed them.
--   round and stage go together -- round 1 is saved in sampling and nowhere else,
--   rounds 2 and up are saved in revision and nowhere else. The CHECK says so, so
--   the rule does not rest on the code alone.
--   program_id cascades -- deleting a card deletes its rounds, as its notes and
--   tasks already are.
--
-- master_sample IS NULLABLE ON PURPOSE. Null means nobody said, which is not the
-- same as No. sent_date, due_back and comment are nullable for the same reason.
-- updated_by and updated_at start NULL and are set only by an edit, so the card
-- can say edited by only when a round really was edited.
--
-- WHO MAY WRITE. Anyone on staff, through one permissive staff_only policy on
-- vessl.is_staff, the same policy programs and program_tasks carry. A round is
-- shared logistics like a checklist task, not someone own words like a note, so
-- there is no author-only policy. created_by and updated_by say who did what.
--
-- REVOKE FIRST. The vessl schema default grants authenticated arwdDxtm on every
-- new table at CREATE time, so not granting DELETE would not withhold it. Revoke
-- everything from public, anon and authenticated, then grant back select, insert
-- and update to authenticated. NO DELETE -- a saved round is a record and a
-- mistake is corrected by editing it. The cascade from a card delete still works
-- because a foreign key action runs as the table owner. c4 asserts the end state.
--
-- THE BACKFILL is one row, copied from the live card at run time rather than
-- from values written here, and found by id plus length. It is guarded -- the
-- card must be in sampling with its strip on round 1, or the script stops and
-- nothing changes. TRE-010 is deliberately left out. Its strip reads round 2 with
-- no dates on a card in Quoting, which the new rules have no place for.
-- created_by is the last person to edit that card, who set the strip.
--
-- MEASURED BEFORE WRITING, against the live database
--   program_sample_rounds does not exist in any schema. Two cards.
--   ZZTESTPLM 3e754941 is in sampling, strip round 1, master sample true, sent
--   2026-01-01, due back 2026-10-01, last edited by mattdillon. TRE-010 e0192d2c
--   is in quoted, strip round 2, master sample true, no dates.
--   program_tasks carries staff_only on vessl.is_staff and authenticated arwd.
--   The schema default ACL is authenticated arwdDxtm.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre80 on commit drop as
  select (select count(*) from pg_class where relname = 'program_sample_rounds')        as tbl_before,
         (select count(*) from vessl.programs)                                           as cards_before,
         (select count(*) from vessl.programs
           where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
             and length(id::text) = 36
             and declared_stage = 'sampling'
             and sample_round = 1)                                                        as zz_ready;

-- A snapshot of the four strip columns on every card, so c5 can prove this script
-- left them alone.
create temp table _strip80 on commit drop as
  select id, sample_round, master_sample_included, sample_sent_date, sample_due_back
    from vessl.programs;

do $guard$
begin
  if (select tbl_before from _pre80) <> 0 then
    raise exception 'program_sample_rounds already exists, nothing changed';
  end if;
  if (select zz_ready from _pre80) <> 1 then
    raise exception 'ZZTESTPLM is not in sampling on strip round 1, nothing changed';
  end if;
end
$guard$;

create table vessl.program_sample_rounds (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references vessl.programs(id) on delete cascade,
  stage         text not null,
  round         integer not null,
  master_sample boolean,
  sent_date     date,
  due_back      date,
  comment       text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz,
  constraint program_sample_rounds_one_per_round unique (program_id, round),
  constraint program_sample_rounds_round_stage_check
    check ((round = 1 and stage = 'sampling') or (round >= 2 and stage = 'revision'))
);

comment on table vessl.program_sample_rounds is
  'Sample rounds saved on a PLM card. Round 1 is saved in sampling, rounds 2 and up in revision, one row per round per card. The latest round is the highest round number, and its due_back drives the sample overdue signals. Editable by any staff, never deleted except with its card.';

alter table vessl.program_sample_rounds enable row level security;

create policy staff_only on vessl.program_sample_rounds
  as permissive for all to authenticated
  using (vessl.is_staff())
  with check (vessl.is_staff());

-- Revoke first. The schema default already granted everything at CREATE time.
revoke all on vessl.program_sample_rounds from public, anon, authenticated;
grant select, insert, update on vessl.program_sample_rounds to authenticated;

-- THE BACKFILL, copied from the card at run time.
insert into vessl.program_sample_rounds
  (program_id, stage, round, master_sample, sent_date, due_back, created_by)
select p.id, 'sampling', 1, p.master_sample_included, p.sample_sent_date, p.sample_due_back, p.updated_by
  from vessl.programs p
 where p.id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
   and length(p.id::text) = 36;

-- PROBES. Five inserts on ZZTESTPLM, each in its own subtransaction. The four the
-- constraints must refuse are refused by Postgres. The fifth is valid, is
-- accepted, and is then undone by raising accepted, so none of the five survives.
-- d1 proves that by counting one row.
create temp table _probe80 (n int, result text) on commit drop;

do $probe$
declare
  zz uuid := '3e754941-1bbc-4fbf-ba6d-c58c1adbef97';
  tries int[][] := array[[1, 1], [2, 2], [3, 0], [4, 1], [5, 2]];
  stages text[] := array['revision', 'sampling', 'sampling', 'sampling', 'revision'];
  r text;
begin
  for i in 1 .. 5 loop
    begin
      insert into vessl.program_sample_rounds (program_id, stage, round)
        values (zz, stages[i], tries[i][2]);
      raise exception 'accepted';
    exception
      when check_violation  then r := 'refused';
      when unique_violation then r := 'duplicate';
      when others           then r := sqlerrm;
    end;
    insert into _probe80 values (tries[i][1], r);
  end loop;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the table did not exist before' as chk,
         (select tbl_before::text from _pre80) as got, '0' as want
  union all
  select 'b1 the table exists now in vessl',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'program_sample_rounds' and c.relkind = 'r'), '1'
  union all
  select 'b2 twelve columns, exactly the ones named',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name in ('id','program_id','stage','round','master_sample','sent_date','due_back',
                                 'comment','created_by','created_at','updated_by','updated_at')), '12'
  union all
  select 'b3 and no columns beyond those twelve',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'), '12'
  union all
  select 'b4 the foreign key points at programs and cascades',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass and contype = 'f'
             and confrelid = 'vessl.programs'::regclass and confdeltype = 'c'), '1'
  union all
  select 'b5 unique on program_id and round',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass and contype = 'u'
             and conname = 'program_sample_rounds_one_per_round'), '1'
  union all
  select 'b6 the round and stage CHECK exists',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass and contype = 'c'
             and conname = 'program_sample_rounds_round_stage_check'), '1'
  union all
  -- THE CONSTRAINTS TESTED, not just found. See the probe block above.
  select 'b7 probes -- 1 in revision, 2 in sampling, 0, a second round 1, then 2 in revision',
         (select string_agg(result, '/' order by n) from _probe80),
         'refused/refused/refused/duplicate/accepted'
  union all
  select 'c1 row level security is on',
         (select relrowsecurity::text from pg_class where oid = 'vessl.program_sample_rounds'::regclass), 'true'
  union all
  select 'c2 one policy, staff_only, permissive, all commands, on is_staff',
         (select string_agg(polname || '/' || polpermissive::text || '/' || polcmd::text || '/'
                            || pg_get_expr(polqual, polrelid), ', ')
            from pg_policy where polrelid = 'vessl.program_sample_rounds'::regclass),
         'staff_only/true/*/vessl.is_staff()'
  union all
  select 'c3 the grant is exactly authenticated arw',
         (select array_to_string(array(select a::text from unnest(relacl) a
                                        where a::text not like 'postgres=%' order by 1), ' ')
            from pg_class where oid = 'vessl.program_sample_rounds'::regclass),
         'authenticated=arw/postgres'
  union all
  select 'c4 authenticated may select insert update, may not delete or truncate',
         (select has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'INSERT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'UPDATE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'DELETE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'TRUNCATE')::text),
         'true/true/true/false/false'
  union all
  select 'c4b anon reaches nothing',
         (select has_table_privilege('anon', 'vessl.program_sample_rounds', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_sample_rounds', 'INSERT')::text), 'false/false'
  union all
  -- THE BACKFILL. One row in the table, on ZZTESTPLM, and it matches the strip.
  select 'd1 exactly one round in the table',
         (select count(*)::text from vessl.program_sample_rounds), '1'
  union all
  select 'd2 it is round 1 in sampling on ZZTESTPLM and matches its strip',
         (select count(*)::text from vessl.program_sample_rounds r
            join vessl.programs p on p.id = r.program_id
           where p.id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
             and length(p.id::text) = 36
             and r.round = 1 and r.stage = 'sampling'
             and r.master_sample is not distinct from p.master_sample_included
             and r.sent_date     is not distinct from p.sample_sent_date
             and r.due_back      is not distinct from p.sample_due_back), '1'
  union all
  select 'd3 the backfilled round reads true, 2026-01-01, 2026-10-01',
         (select master_sample::text || '/' || sent_date::text || '/' || due_back::text
            from vessl.program_sample_rounds), 'true/2026-01-01/2026-10-01'
  union all
  select 'd4 it names who saved it and has not been edited',
         (select (created_by is not null)::text || '/' || (updated_by is null and updated_at is null)::text
            from vessl.program_sample_rounds), 'true/true'
  union all
  select 'd5 TRE-010 has no round',
         (select count(*)::text from vessl.program_sample_rounds
           where program_id = 'e0192d2c-2571-40bb-8ba4-7ec13683e059'::uuid), '0'
  union all
  -- THE FOUR programs COLUMNS LEFT ALONE, compared against the snapshot.
  select 'e1 every card strip is unchanged',
         (select count(*)::text from vessl.programs p join _strip80 s on s.id = p.id
           where p.sample_round           is not distinct from s.sample_round
             and p.master_sample_included is not distinct from s.master_sample_included
             and p.sample_sent_date       is not distinct from s.sample_sent_date
             and p.sample_due_back        is not distinct from s.sample_due_back),
         (select cards_before::text from _pre80)
  union all
  select 'e2 no card was added or removed',
         (select ((select count(*) from vessl.programs) - cards_before)::text from _pre80), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
