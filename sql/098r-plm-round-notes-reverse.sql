-- 98r -- Reverse 98. Round notes become plain Card Notes, their round written into the text.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 98. One transaction.
--
-- WHAT IT DOES
--   1. Every note that carries a round number keeps it in words -- its text
--      gains the prefix Round N then two dashes then a space, so nothing a person
--      wrote loses what it was about. edited_at is left alone, because nobody
--      edited the note.
--   2. Drops the index, the two CHECKs, the foreign key and both columns.
-- No note is deleted.
--
-- GUARDS. Both columns exist, which proves 98 ran.
--
-- AFTER
--   b1 the columns and constraints are gone
--   b2 the same notes exist, by count
--   b3 the text grew by exactly the prefixes and nothing else -- measured as the
--      total length, so no note text has to be matched
--   b4 every other column of every note is unchanged
--
-- WHAT A PASS LOOKS LIKE. r1 (how many notes were prefixed) plus z0. Any a or b
-- row is a failed check.

begin;

create temp table _pre98r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_notes'
        and column_name in ('round_id', 'round_no'))                                             as n_cols;

do $guard$
begin
  if (select n_cols from _pre98r) <> 2 then
    raise exception 'program_notes does not have both round columns, so 98 is not in place, nothing changed';
  end if;
end
$guard$;

-- Read through to_jsonb so the measuring parses on its own terms.
create temp table _notes98r on commit drop as
  select
    (select count(*) from vessl.program_notes)                                                   as t_notes,
    (select count(*) from vessl.program_notes n where (to_jsonb(n) ->> 'round_no') is not null) as n_prefixed,
    (select coalesce(sum(length(note)), 0) from vessl.program_notes)                             as len_before,
    (select coalesce(sum(length('Round ' || (to_jsonb(n) ->> 'round_no') || ' -- ')), 0)
       from vessl.program_notes n where (to_jsonb(n) ->> 'round_no') is not null)                as len_prefixes,
    (select md5(coalesce(string_agg((to_jsonb(n) - 'note' - 'round_id' - 'round_no')::text, '/' order by n.id), ''))
       from vessl.program_notes n)                                                               as h_rest;

update vessl.program_notes
   set note = 'Round ' || round_no::text || ' -- ' || note
 where round_no is not null;

drop index vessl.program_notes_round_id_idx;
alter table vessl.program_notes drop constraint program_notes_round_has_no;
alter table vessl.program_notes drop constraint program_notes_round_no_check;
alter table vessl.program_notes drop constraint program_notes_round_id_fkey;
alter table vessl.program_notes drop column round_id;
alter table vessl.program_notes drop column round_no;

-- VERIFICATION. r1 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r1 notes that kept their round in words' as chk,
         (select n_prefixed::text from _notes98r) as got,
         'shown every run' as want
  union all
  select 'a0 both round columns existed',
         (select n_cols::text from _pre98r), '2'
  union all
  select 'b1 columns, CHECKs, foreign key and index are gone',
         (select (select count(*) from information_schema.columns
                   where table_schema = 'vessl' and table_name = 'program_notes'
                     and column_name in ('round_id', 'round_no'))::text
                 || '/' || (select count(*) from pg_constraint
                             where conrelid = 'vessl.program_notes'::regclass
                               and conname in ('program_notes_round_id_fkey', 'program_notes_round_no_check',
                                               'program_notes_round_has_no'))::text
                 || '/' || (select count(*) from pg_indexes
                             where schemaname = 'vessl' and indexname = 'program_notes_round_id_idx')::text),
         '0/0/0'
  union all
  select 'b2 the same number of notes',
         (select count(*)::text from vessl.program_notes), (select t_notes::text from _notes98r)
  union all
  select 'b3 the text grew by exactly the prefixes',
         (select coalesce(sum(length(note)), 0)::text from vessl.program_notes),
         (select (len_before + len_prefixes)::text from _notes98r)
  union all
  select 'b4 every other column of every note is unchanged',
         (select md5(coalesce(string_agg((to_jsonb(n) - 'note')::text, '/' order by n.id), ''))
            from vessl.program_notes n),
         (select h_rest from _notes98r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
