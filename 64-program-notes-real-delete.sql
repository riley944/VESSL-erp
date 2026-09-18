-- 64 -- delete means delete.
--
-- WHAT IT DOES. Grants DELETE on vessl.program_notes to authenticated, adds a
-- RESTRICTIVE policy confining deletes to rows the caller wrote, and drops the
-- deleted_at column that script 63 added three hours earlier.
--
-- WHY IT REVERSES 63 SO QUICKLY. 63 shipped a soft delete -- a deleted_at stamp
-- and a filter that hid the row -- on the reasoning that a note is a record and a
-- record should not be destroyable. One round of looking at it changed the answer.
-- A note nobody can see and nobody can remove is a row that only accumulates, and
-- the list it hides from is the only place anybody would ever read it. Hiding was
-- protecting the wrong thing.
--
-- WHAT PROTECTS A NOTE NOW is that it is yours and nobody else can touch it. The
-- delete policy is the same shape as the update one 63 added, character for
-- character, including the empty author exclusion -- a row nobody signed can be
-- deleted by nobody.
--
-- edited_at STAYS. It records that words changed after they were written, which is
-- still true and still worth saying on the card. Only deleted_at goes.
--
-- NOTHING IS LOST BY THE DROP, and the guard proves it rather than assuming it.
-- deleted_at is set on ZERO rows, measured now. If anything had been soft deleted
-- between 63 running and this, the guard refuses and the column stays until
-- somebody decides what those rows are.
--
-- NO PROBE, for the same reason 63 had none. The SQL editor runs as the table
-- owner and RLS does not apply to the owner, so a probe could only prove that an
-- owner can delete. The GRANT is tested for real by has_table_privilege, which
-- asks about authenticated rather than about the caller. Author-only enforcement
-- is verified in the application, signed in as two different people.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.program_notes -- 8 columns, 1 row, RLS enabled.
--   deleted_at present, set on 0 rows. edited_at present, set on 0 rows.
--   Two policies -- staff_only permissive ALL, notes_author_only_update
--   restrictive UPDATE.
--   authenticated holds SELECT and INSERT at table level. UPDATE and DELETE both
--   false. Column level UPDATE on note, edited_at and deleted_at only.

begin;

-- PRE-STATE FIRST, counted before anything is written.
create temp table _pre64 on commit drop as
  select (select count(*) from vessl.program_notes)                            as notes_before,
         (select count(*) from vessl.programs)                                 as programs_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes')      as cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name = 'deleted_at')                                   as had_deleted_at,
         (select count(*) from vessl.program_notes where deleted_at is not null) as soft_deleted,
         (select count(*) from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes')         as policies_before,
         has_table_privilege('authenticated','vessl.program_notes','DELETE')    as had_delete;

-- REFUSE rather than drop a column that is carrying something, or change a table
-- that is not the one measured.
do $guard$
begin
  if (select had_deleted_at from _pre64) <> 1 then
    raise exception 'program_notes has no deleted_at column, nothing changed';
  end if;
  if (select soft_deleted from _pre64) <> 0 then
    raise exception 'some notes are soft deleted, so dropping the column would lose that, nothing changed';
  end if;
  if (select policies_before from _pre64) <> 2 then
    raise exception 'program_notes does not carry the two policies measured, nothing changed';
  end if;
  if (select had_delete from _pre64) then
    raise exception 'authenticated already holds DELETE, nothing changed';
  end if;
end
$guard$;

-- 1. DELETE, at table level. There is no such thing as a column level delete --
--    a delete removes the whole row, so the policy below is what narrows it.
grant delete on vessl.program_notes to authenticated;

-- 2. The same rule as the update policy, pointed at deletes. RESTRICTIVE so it
--    ANDs with staff_only rather than widening beside it.
--
--    USING ONLY, and no WITH CHECK. A delete produces no new row, so there is
--    nothing for a check expression to test -- Postgres does not accept one here.
--
--    THE EMPTY AUTHOR IS EXCLUDED, exactly as in 63. Without it a row with no
--    author would match a caller whose token carries no address, both sides
--    collapsing to the empty string. A note nobody signed is deletable by nobody.
create policy notes_author_only_delete on vessl.program_notes
  as restrictive for delete to authenticated
  using (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- 3. The soft delete column goes. Done last, so the real delete is in place before
--    the thing it replaces is removed.
alter table vessl.program_notes drop column deleted_at;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 deleted_at was there and carried nothing' as chk,
         (select had_deleted_at::text || '/' || soft_deleted::text from _pre64) as got, '1/0' as want
  union all
  select 'a1 authenticated had no DELETE before',
         (select had_delete::text from _pre64), 'false'
  union all
  select 'a2 two policies before',
         (select policies_before::text from _pre64), '2'
  union all
  select 'b1 DELETE is granted now',
         (has_table_privilege('authenticated','vessl.program_notes','DELETE'))::text, 'true'
  union all
  select 'b2 the delete policy is restrictive and for delete',
         (select permissive || '/' || cmd from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname = 'notes_author_only_delete'), 'RESTRICTIVE/DELETE'
  union all
  select 'b3 it tests the caller token address',
         (select (case when qual like '%auth.jwt%' and qual like '%btrim%' then 'yes' else 'no' end)::text
            from pg_policies where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname = 'notes_author_only_delete'), 'yes'
  union all
  select 'b4 deleted_at is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name = 'deleted_at'), '0'
  union all
  select 'b5 edited_at kept, and seven columns now',
         (select (select count(*) from information_schema.columns
                   where table_schema = 'vessl' and table_name = 'program_notes'
                     and column_name = 'edited_at')::text
              || '/' ||
                 (select count(*) from information_schema.columns
                   where table_schema = 'vessl' and table_name = 'program_notes')::text), '1/7'
  union all
  select 'b6 note and edited_at keep their update grants',
         (select has_column_privilege('authenticated','vessl.program_notes','note','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','edited_at','UPDATE')::text),
         'true/true'
  union all
  select 'b7 three policies now, both earlier ones still there',
         (select count(*)::text from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname in ('staff_only','notes_author_only_update','notes_author_only_delete')), '3'
  union all
  -- GRANTING DELETE MUST NOT HAVE DELETED ANYTHING. The one note that exists is
  -- still there.
  select 'c1 no note row removed',
         (select ((select count(*) from vessl.program_notes) - (select notes_before from _pre64))::text), '0'
  union all
  select 'c2 programs untouched',
         (select ((select count(*) from vessl.programs) - (select programs_before from _pre64))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
