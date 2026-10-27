-- 98 -- PLM, notes on a sample round, kept as Card Notes when the round is deleted.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 98r.
--
-- WHY. Each sample round gets its own notes, several per round, each with its
-- author and date, the way Card Notes work (1 Oct). They live in
-- program_notes, so they inherit its policies -- staff only, and only the
-- author may edit or delete -- and the notes panel the card already uses.
--
-- WHAT IT DOES. Two columns on vessl.program_notes.
--   round_id  uuid, the round the note belongs to. ON DELETE SET NULL -- deleting
--             a round does NOT delete its notes; they stay on the card.
--   round_no  integer, the round number, written with the note. It is what
--             keeps a note reading Round 2 after round 2 is deleted, because
--             SET NULL clears round_id and leaves round_no alone.
-- Two CHECKs. round_no is 1 or more, and a note on a round always carries its
-- number -- so no round note can lose its label. An index on round_id for the
-- per-round reads.
--
-- WHY THE NUMBER IS STORED AT INSERT, not stamped at delete. authenticated may
-- update only note and edited_at, and the restrictive policy limits that to the
-- author, so the app could never stamp somebody else note at delete time. A
-- number written once, at insert, needs no later write at all, and neither
-- column can be changed afterwards by anybody but postgres.
--
-- GUARDS, before any change.
--   neither column exists yet
--   the ZZTESTPLM round 2 the probes use exists by id
--
-- PROBES, each undone.
--   p1 a note on a round with its number is accepted
--   p2 a note on a round without its number is refused
--   p3 round number 0 is refused
--   p4 a note on a round survives the round being deleted, with round_id now
--      NULL and round_no still 2
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre98 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_notes'
        and column_name in ('round_id', 'round_no'))                                             as n_cols,
    (select count(*) from vessl.program_sample_rounds
      where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid
        and program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid and round = 2)            as probe_round,
    (select count(*) from vessl.program_notes)                                                   as t_notes,
    (select count(*) from vessl.program_sample_rounds)                                           as t_rounds,
    (select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
       from vessl.program_notes n)                                                               as h_notes;

do $guard$
begin
  if (select n_cols from _pre98) <> 0 then
    raise exception 'program_notes already has round_id or round_no, nothing changed';
  end if;
  if (select probe_round from _pre98) <> 1 then
    raise exception 'the ZZTESTPLM round 2 the probes use is missing, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_notes
  add column round_id uuid
    constraint program_notes_round_id_fkey
    references vessl.program_sample_rounds (id) on delete set null;
alter table vessl.program_notes add column round_no integer;
alter table vessl.program_notes add constraint program_notes_round_no_check
  check (round_no is null or round_no >= 1);
alter table vessl.program_notes add constraint program_notes_round_has_no
  check (round_id is null or round_no is not null);
create index program_notes_round_id_idx on vessl.program_notes (round_id);

comment on column vessl.program_notes.round_id is
  'The sample round this note was written on (script 98). NULL for a Card Note, and set to NULL when the round is deleted -- the note stays on the card.';
comment on column vessl.program_notes.round_no is
  'The round number, written with the note (script 98). Kept when the round is deleted, so the note still reads as that round.';

create temp table _probe98 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  nid uuid;
begin
  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'round', 'probe 98', 'sampling',
            '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, 2);
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe98 values (1, 'refused');
    when raise_exception then insert into _probe98 select 1, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'round', 'probe 98', 'sampling',
            '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, null);
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe98 values (2, 'refused');
    when raise_exception then insert into _probe98 select 2, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'round', 'probe 98', 'sampling',
            '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, 0);
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe98 values (3, 'refused');
    when raise_exception then insert into _probe98 select 3, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, null, 'round', 'probe 98', 'sampling',
            '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, 2)
    returning id into nid;
    delete from vessl.program_sample_rounds where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    select count(*) into n from vessl.program_notes
     where id = nid and round_id is null and round_no = 2;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe98 select 4, case when n = 1 then 'kept' else 'lost' end;
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 no round columns yet, probe round present' as chk,
         (select n_cols::text || '/' || probe_round::text from _pre98) as got,
         '0/1' as want
  union all
  select 'b1 round_id is uuid and round_no is integer, both nullable',
         (select string_agg(column_name || ' ' || data_type || ' ' || is_nullable, '/' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name in ('round_id', 'round_no')),
         'round_id uuid YES/round_no integer YES'
  union all
  select 'b2 the foreign key points at the rounds and sets NULL on delete',
         (select confrelid::regclass::text || '/' || confdeltype::text from pg_constraint
           where conrelid = 'vessl.program_notes'::regclass and conname = 'program_notes_round_id_fkey'),
         'vessl.program_sample_rounds/n'
  union all
  select 'b3 both CHECKs exist and are validated, and the index exists',
         (select count(*)::text || '/' || bool_and(convalidated)::text from pg_constraint
           where conrelid = 'vessl.program_notes'::regclass
             and conname in ('program_notes_round_no_check', 'program_notes_round_has_no'))
         || '/' || (select count(*)::text from pg_indexes
                     where schemaname = 'vessl' and indexname = 'program_notes_round_id_idx'),
         '2/true/1'
  union all
  select 'b4 probes -- note with number ok, without number refused, round 0 refused, kept after round delete',
         (select string_agg(result, '/' order by step) from _probe98), 'ok/refused/refused/kept'
  union all
  select 'b5 the probes left nothing -- notes and rounds as before, the probe round still there',
         (select ((select count(*) from vessl.program_notes) - t_notes)::text
                 || '/' || ((select count(*) from vessl.program_sample_rounds) - t_rounds)::text
                 || '/' || (select count(*) from vessl.program_sample_rounds
                             where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid)::text
            from _pre98), '0/0/1'
  union all
  select 'b6 every existing note unchanged apart from the two new empty columns',
         (select md5(coalesce(string_agg((to_jsonb(n) - 'round_id' - 'round_no')::text, '/' order by n.id), ''))
            from vessl.program_notes n),
         (select h_notes from _pre98)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
