-- 100 -- PLM, when a sample round is renumbered its notes follow.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 100r.
--
-- WHY. The number of a saved round becomes editable from its Edit form (1 Oct). Its
-- notes carry the number as program_notes.round_no (script 98), and staff cannot
-- update that column -- authenticated may update only note and edited_at, and
-- only on notes they wrote. So the database keeps them in step.
--
-- WHAT IT DOES
--   vessl.sync_round_note_numbers(), a trigger function. SECURITY DEFINER, owned
--   by postgres, so it can update every note on the round whoever wrote it --
--   postgres owns program_notes and bypasses its row security. search_path is
--   empty and every name is written in full. EXECUTE is revoked from PUBLIC,
--   anon and authenticated; a trigger function cannot be called on its own
--   anyway, and nobody needs to.
--   trg_round_note_numbers, AFTER UPDATE OF round on program_sample_rounds, one
--   row at a time, only WHEN the number actually changed. It sets round_no to
--   the new number on the notes whose round_id is this round.
--
-- WHAT IT NEVER TOUCHES
--   notes from a round already deleted -- their round_id is NULL, so no round
--   points at them and they keep the number they were written under
--   edited_at, or any column but round_no -- program_notes has no trigger to
--   stamp it, and the update names round_no alone
--   the round number itself -- the unique (program_id, round) constraint still
--   refuses a number another round on the card holds, before this runs
--
-- authenticated already holds UPDATE on program_sample_rounds and on its round
-- column (a0 checks), so no grant changes.
--
-- PROBES, each undone.
--   p1 as postgres -- a note on ZZTESTPLM round 2, plus a note from a deleted
--      round 2 (round_id NULL). Round 2 becomes 9. The first note reads 9 with
--      edited_at unmoved; the second still reads 2.
--   p2 as a signed-in staff user (authenticated, email mattdillon) -- the same
--      renumber through the policies the app goes through. The note follows.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre100 on commit drop as
  select
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'vessl' and p.proname = 'sync_round_note_numbers')                      as has_fn,
    (select count(*) from pg_trigger
      where tgrelid = 'vessl.program_sample_rounds'::regclass and tgname = 'trg_round_note_numbers') as has_trg,
    (has_column_privilege('authenticated', 'vessl.program_sample_rounds', 'round', 'UPDATE'))::text
      || '/' || (select relforcerowsecurity::text from pg_class where oid = 'vessl.program_notes'::regclass)
      || '/' || (select pg_get_userbyid(relowner) from pg_class where oid = 'vessl.program_notes'::regclass) as grants,
    (select count(*) from vessl.program_sample_rounds
      where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid
        and program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid and round = 2)            as probe_round,
    (select count(*) from vessl.program_sample_rounds
      where program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid and round = 9)            as nine_taken,
    (select count(*) from vessl.program_notes)                                                   as t_notes,
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rounds;

do $guard$
begin
  if (select has_fn + has_trg from _pre100) <> 0 then
    raise exception 'the function or the trigger already exists, nothing changed';
  end if;
  if (select grants from _pre100) is distinct from 'true/false/postgres' then
    raise exception 'grants or ownership are not as measured -- %, nothing changed', (select grants from _pre100);
  end if;
  if (select probe_round from _pre100) <> 1 or (select nine_taken from _pre100) <> 0 then
    raise exception 'ZZTESTPLM round 2 is missing or round 9 is taken, so the probes cannot run, nothing changed';
  end if;
end
$guard$;

create function vessl.sync_round_note_numbers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update vessl.program_notes
     set round_no = new.round
   where round_id = new.id
     and round_no is distinct from new.round;
  return null;
end
$fn$;

comment on function vessl.sync_round_note_numbers() is
  'Script 100. When a sample round is renumbered, its notes take the new number in program_notes.round_no. Notes from deleted rounds (round_id NULL) are not touched, and nor is edited_at.';

revoke all on function vessl.sync_round_note_numbers() from public;
revoke all on function vessl.sync_round_note_numbers() from anon;
revoke all on function vessl.sync_round_note_numbers() from authenticated;

create trigger trg_round_note_numbers
  after update of round on vessl.program_sample_rounds
  for each row
  when (old.round is distinct from new.round)
  execute function vessl.sync_round_note_numbers();

create temp table _probe100 (step int, result text) on commit drop;

do $probe$
declare
  live_id uuid;
  dead_id uuid;
  live_no int;
  dead_no int;
  ed_same boolean;
begin
  -- p1, as postgres.
  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no, edited_at)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 'mattdillon@kinguniversal.com', 'round', 'probe 100 live',
            'sampling', '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, 2, timestamptz '2026-01-01')
    returning id into live_id;
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 'mattdillon@kinguniversal.com', 'round', 'probe 100 dead',
            'sampling', null, 2)
    returning id into dead_id;
    update vessl.program_sample_rounds set round = 9 where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    select round_no, edited_at = timestamptz '2026-01-01' into live_no, ed_same
      from vessl.program_notes where id = live_id;
    select round_no into dead_no from vessl.program_notes where id = dead_id;
    raise exception 'probe undo';
  exception
    when raise_exception then
      insert into _probe100 values (1, live_no::text || '/' || ed_same::text || '/' || dead_no::text);
  end;

  -- p2, as a signed-in staff user. The role and the claims revert when the
  -- block is undone.
  begin
    insert into vessl.program_notes (program_id, author, source, note, stage, round_id, round_no)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 'mattdillon@kinguniversal.com', 'round', 'probe 100 staff',
            'sampling', '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid, 2)
    returning id into live_id;
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.program_sample_rounds set round = 9 where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    select round_no into live_no from vessl.program_notes where id = live_id;
    raise exception 'probe undo';
  exception
    when raise_exception then
      insert into _probe100 values (2, coalesce(live_no::text, 'unread'));
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 nothing installed yet, round UPDATE granted, notes owned by postgres and not forced, probe round free to move' as chk,
         (select has_fn::text || '/' || has_trg::text || '/' || grants || '/' || probe_round::text
                 || '/' || nine_taken::text from _pre100) as got,
         '0/0/true/false/postgres/1/0' as want
  union all
  select 'b1 the function is SECURITY DEFINER, owned by postgres, empty search_path, not executable by anon or authenticated',
         (select p.prosecdef::text || '/' || pg_get_userbyid(p.proowner) || '/'
                 || coalesce(array_to_string(p.proconfig, ','), 'none') || '/'
                 || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/'
                 || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'vessl' and p.proname = 'sync_round_note_numbers'),
         'true/postgres/search_path=""/false/false'
  union all
  -- tgtype 17 is ROW (1) plus UPDATE (16) with the BEFORE bit (2) clear, so an
  -- AFTER UPDATE row trigger. tgattr is the column list of UPDATE OF.
  select 'b2 the trigger is on program_sample_rounds, enabled, after update of round alone, one row at a time',
         (select count(*)::text || '/' || bool_and(t.tgenabled = 'O')::text || '/' || min(t.tgtype)::text
                 || '/' || min(array_length(t.tgattr::int2[], 1))::text || '/' || min(a.attname::text)
            from pg_trigger t
            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = t.tgattr[0]
           where t.tgrelid = 'vessl.program_sample_rounds'::regclass and t.tgname = 'trg_round_note_numbers'),
         '1/true/17/1/round'
  union all
  select 'b3 probe as postgres -- the live note reads 9 with edited_at unmoved, the deleted-round note still 2',
         (select result::text from _probe100 where step = 1), '9/true/2'
  union all
  select 'b4 probe as signed-in staff -- the note follows the round to 9',
         (select result::text from _probe100 where step = 2), '9'
  union all
  select 'b5 the probes left nothing -- same notes, every round as it was',
         (select ((select count(*) from vessl.program_notes) - t_notes)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                               from vessl.program_sample_rounds r) = h_rounds)::text
            from _pre100), '0/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
