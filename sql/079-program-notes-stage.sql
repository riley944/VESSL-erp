-- 79 -- Card Notes belong to a stage.
--
-- WHAT IT DOES. Adds one nullable column, vessl.program_notes.stage, with a CHECK
-- limiting it to the six stage keys, and fills it for the notes that exist now
-- with the stage their card is in at the moment this runs. No grant is changed,
-- no policy is touched, and no note text is changed.
--
-- WHY. Card Notes on the first tab become per stage. A note written while the
-- card is in Quoting shows while the card is in Quoting, is out of sight when it
-- moves on, and shows again when it comes back. The card needs to know which
-- stage each note was written in, and program_notes has no column that says so.
-- General Notes are product_notes and are not touched here.
--
-- THE SIX VALUES, the same list the programs and program_tasks CHECKs carry --
-- quoted, sampling, revision, testing, production, shipped. NULL stays legal and
-- means a note that belongs to no stage, which the card shows in every stage. A
-- note written on a card that has no stage set is one of those.
--
-- THE BACKFILL is every note whose card has a stage now, set to that stage. It
-- is a join on program_id, not a list of ids, so a note written between
-- measuring and running is covered too. A note on a card with no stage stays
-- NULL. It writes stage and nothing else -- the note text and edited_at are left
-- alone, so no note starts reading as edited. There is no trigger on the table.
--
-- NO GRANT WORK, asserted as scripts 77 and 78 did. authenticated holds table
-- level ard on program_notes -- INSERT, SELECT and DELETE -- which covers a
-- column added afterwards, so the app can write stage on insert and read it
-- back. UPDATE is held only as column grants on note and edited_at, so
-- authenticated CANNOT update stage, and that is the intent -- the stage a note
-- was written in is a fact about its writing and is never edited. b6 asserts all
-- three, and b7 asserts the two existing column grants are unchanged.
--
-- THE AUTHOR POLICIES ARE UNAFFECTED. notes_author_only_update and
-- notes_author_only_delete read only author and the email in the caller token,
-- and staff_only reads only vessl.is_staff. None of them names a column this
-- adds. b8 asserts the three policies are all still there.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.program_notes -- 7 columns, no stage. 1 row, source manual, on the
--   ZZTESTPLM card, which is in sampling -- so the backfill is 1 row, to sampling.
--   relacl is postgres arwdDxtm and authenticated ard. Column grants give
--   authenticated UPDATE on note and on edited_at only. 3 policies. No trigger.
--   One foreign key, program_id to programs on delete cascade.

begin;

-- PRE-STATE FIRST, before the column exists.
create temp table _pre79 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name = 'stage')                                          as col_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes')        as all_cols_before,
         (select count(*) from vessl.program_notes)                              as rows_before,
         (select count(*) from vessl.program_notes n
            join vessl.programs p on p.id = n.program_id
           where p.declared_stage is not null)                                   as to_backfill,
         (select count(*) from vessl.program_notes n
            join vessl.programs p on p.id = n.program_id
           where p.declared_stage is null)                                       as stay_null,
         (select coalesce(sum(length(note)), 0) from vessl.program_notes)        as text_len_before,
         (select count(*) from vessl.program_notes where edited_at is not null)  as edited_before,
         (select relacl::text from pg_class where oid = 'vessl.program_notes'::regclass) as acl_before,
         (select count(*) from pg_policy where polrelid = 'vessl.program_notes'::regclass) as policies_before;

do $guard$
begin
  if (select col_before from _pre79) <> 0 then
    raise exception 'vessl.program_notes already has stage, nothing changed';
  end if;
  if not has_table_privilege('authenticated', 'vessl.program_notes', 'INSERT') then
    raise exception 'authenticated cannot insert into vessl.program_notes, so the card could not write stage, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_notes
  add column stage text;

alter table vessl.program_notes
  add constraint program_notes_stage_check
  check (stage is null or stage = any (array['quoted','sampling','revision','testing','production','shipped']));

comment on column vessl.program_notes.stage is
  'The stage the card was in when the note was written, one of the six stage keys. The card shows a note only while it is in that stage. Null means the note belongs to no stage and shows in every stage. Written on insert, never updated.';

update vessl.program_notes n
   set stage = p.declared_stage
  from vessl.programs p
 where p.id = n.program_id
   and p.declared_stage is not null;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 stage did not exist before' as chk,
         (select col_before::text from _pre79) as got, '0' as want
  union all
  select 'b1 stage exists now as text',
         (select string_agg(data_type, ' ') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name = 'stage'), 'text'
  union all
  select 'b2 stage is nullable and carries no default',
         (select is_nullable || coalesce(column_default, 'none') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name = 'stage'), 'YESnone'
  union all
  -- THE SIX VALUES AND NULL, counted in the constraint as the database stored
  -- it -- six of the six stage words each appear quoted, and NULL is allowed.
  select 'b3 the CHECK names all six stages and allows NULL',
         (select count(*)::text from unnest(array['quoted','sampling','revision','testing','production','shipped']) v
           where (select pg_get_constraintdef(oid) from pg_constraint
                   where conrelid = 'vessl.program_notes'::regclass
                     and conname = 'program_notes_stage_check') like '%''' || v || '''%')
         || '/' ||
         (select (pg_get_constraintdef(oid) like '%stage IS NULL%')::text from pg_constraint
           where conrelid = 'vessl.program_notes'::regclass
             and conname = 'program_notes_stage_check'), '6/true'
  union all
  -- THE BACKFILL, both halves. Every note on a staged card now carries exactly
  -- that stage, and every note on an unstaged card is still NULL.
  select 'b4 every note on a staged card carries that stage',
         (select count(*)::text from vessl.program_notes n
            join vessl.programs p on p.id = n.program_id
           where p.declared_stage is not null
             and n.stage is not distinct from p.declared_stage),
         (select to_backfill::text from _pre79)
  union all
  select 'b5 notes on a card with no stage are still NULL',
         (select count(*)::text from vessl.program_notes n
            join vessl.programs p on p.id = n.program_id
           where p.declared_stage is null and n.stage is null),
         (select stay_null::text from _pre79)
  union all
  -- THE REASON THERE IS NO GRANT BLOCK, and the reason stage cannot be edited.
  select 'b6 authenticated may insert and select stage, and may not update it',
         (select has_column_privilege('authenticated', 'vessl.program_notes', 'stage', 'INSERT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.program_notes', 'stage', 'SELECT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.program_notes', 'stage', 'UPDATE')::text),
         'true/true/false'
  union all
  select 'b7 note and edited_at are still updatable, so editing a note still works',
         (select has_column_privilege('authenticated', 'vessl.program_notes', 'note', 'UPDATE')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.program_notes', 'edited_at', 'UPDATE')::text),
         'true/true'
  union all
  select 'b8 the three policies are all still there',
         (select count(*)::text from pg_policy
           where polrelid = 'vessl.program_notes'::regclass
             and polname in ('notes_author_only_update', 'notes_author_only_delete', 'staff_only')),
         '3'
  union all
  select 'b8b and no policy was added or dropped',
         (select count(*)::text from pg_policy where polrelid = 'vessl.program_notes'::regclass),
         (select policies_before::text from _pre79)
  union all
  select 'b9 the table grant itself is unchanged',
         (select relacl::text from pg_class where oid = 'vessl.program_notes'::regclass),
         (select acl_before::text from _pre79)
  union all
  select 'b10 anon still reaches nothing on program_notes',
         (select has_table_privilege('anon', 'vessl.program_notes', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_notes', 'INSERT')::text), 'false/false'
  union all
  -- THE BACKFILL IS NOT AN EDIT. No note text moved and no note gained an
  -- edited stamp, measured as the total length and the edited count.
  select 'b11 no note text changed and no note became edited',
         (select coalesce(sum(length(note)), 0)::text || '/' ||
                 count(*) filter (where edited_at is not null)::text from vessl.program_notes),
         (select text_len_before::text || '/' || edited_before::text from _pre79)
  union all
  select 'c1 one column was added and nothing was dropped',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'program_notes') - all_cols_before)::text
            from _pre79), '1'
  union all
  select 'c2 no note was added or removed',
         (select ((select count(*) from vessl.program_notes) - rows_before)::text from _pre79), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
