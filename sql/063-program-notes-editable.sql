-- 63 -- a note can be corrected by the person who wrote it.
--
-- WHAT IT DOES. Adds edited_at and deleted_at to vessl.program_notes, grants
-- UPDATE on three columns only, and adds a RESTRICTIVE policy confining those
-- updates to rows the caller wrote.
--
-- THIS REVERSES THE APPEND ONLY DECISION, narrowly and on purpose. Script 48 left
-- authenticated holding SELECT and INSERT and nothing else, and the comment on the
-- notes component said so proudly. The reason it reverses is simpler than the
-- reason it was made -- somebody typing a note into a card gets it wrong sometimes,
-- and a record nobody can correct is a record people stop trusting.
--
-- WHAT IS NOT REVERSED. There is no DELETE grant and this script does not add one.
-- Hiding a note sets deleted_at and the list stops selecting it. The row stays,
-- and nothing the application can send will destroy it.
--
-- THE GRANT IS PER COLUMN, which is the part doing the real work. authenticated
-- gains UPDATE on note, edited_at and deleted_at. It gains nothing on id,
-- program_id, author, source or created_at, so a note cannot be reassigned to
-- somebody else or backdated. Column privileges live in pg_attribute.attacl rather
-- than in relacl, and b3 and b4 read them through has_column_privilege, which
-- answers for a named role from any connection.
--
-- THE POLICY HAS TO BE RESTRICTIVE. staff_only on this table is FOR ALL and
-- permissive, so it already permits UPDATE at the policy layer -- append only was
-- being enforced entirely by the missing grant. Permissive policies OR together,
-- so a second permissive policy would confine nothing. A restrictive one ANDs with
-- what is there, which is the only shape that means only your own rows. The same
-- pattern vessl.quotes already uses with its restrictive kui_staff_only.
--
-- NO PROBE, AND THAT IS DELIBERATE. The SQL editor runs as the table owner and RLS
-- does not apply to the owner, so a probe here could only prove that the owner can
-- do what owners can do. The grants below ARE tested, by has_column_privilege,
-- which asks about authenticated rather than about the caller. Author-only
-- enforcement is verified in the application, signed in as two different people --
-- it is not a claim this script can make.
--
-- COUNTS ARE ASSERTED AS DIFFERENCES, NOT ABSOLUTES, and the table ACL is compared
-- against its own snapshot rather than a written literal, so an unrelated grant
-- elsewhere cannot fail a correct run.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.program_notes -- 6 columns, 1 row, RLS enabled, no column level grants.
--   One policy, staff_only, permissive, FOR ALL, using vessl.is_staff().
--   authenticated holds SELECT and INSERT. UPDATE and DELETE both false.
--   vessl.is_staff() exists. The house idiom for the caller address is
--   lower(coalesce(auth.jwt() ->> the email claim, the empty string)), as
--   vessl.staff_profiles.read_own_profile already writes it.

begin;

-- PRE-STATE FIRST, counted before anything is written.
create temp table _pre63 on commit drop as
  select (select count(*) from vessl.program_notes)                          as notes_before,
         (select count(*) from vessl.programs)                               as programs_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes')    as cols_before,
         (select count(*) from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes')       as policies_before,
         (select relacl::text from pg_class where oid = 'vessl.program_notes'::regclass) as acl_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name in ('edited_at','deleted_at'))                  as had_cols,
         has_table_privilege('authenticated','vessl.program_notes','UPDATE')  as had_update;

-- REFUSE rather than change a table that is not the one measured.
do $guard$
begin
  if (select had_cols from _pre63) <> 0 then
    raise exception 'program_notes already carries edited_at or deleted_at, nothing changed';
  end if;
  if (select cols_before from _pre63) <> 6 then
    raise exception 'program_notes is not the six column table measured, nothing changed';
  end if;
  if (select policies_before from _pre63) <> 1 then
    raise exception 'program_notes does not carry exactly the one policy measured, nothing changed';
  end if;
  if (select had_update from _pre63) then
    raise exception 'authenticated already holds table level UPDATE, nothing changed';
  end if;
end
$guard$;

-- 1. The two stamps. Both nullable, because every row that exists predates them
--    and a note that was never edited has no edit time.
alter table vessl.program_notes
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

-- 2. UPDATE on three columns and no others. Anything not named here stays
--    unwritable, so author and created_at cannot be rewritten by the app.
grant update (note, edited_at, deleted_at) on vessl.program_notes to authenticated;

-- 3. Only the author, and only for UPDATE. RESTRICTIVE so it ANDs with staff_only
--    rather than widening beside it.
--
--    THE EMPTY AUTHOR IS EXCLUDED ON PURPOSE. author is nullable, and without the
--    final test a row with no author would match a caller whose token carries no
--    address, both sides collapsing to the empty string. Nobody may edit a note
--    that nobody signed.
--
--    WITH CHECK repeats USING so a row cannot be edited into somebody else name --
--    though the column grant already refuses that, the policy says it too.
create policy notes_author_only_update on vessl.program_notes
  as restrictive for update to authenticated
  using (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  )
  with check (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 six columns before, neither stamp present' as chk,
         (select cols_before::text || '/' || had_cols::text from _pre63) as got, '6/0' as want
  union all
  select 'a1 one policy before',
         (select policies_before::text from _pre63), '1'
  union all
  select 'a2 authenticated had no table level UPDATE',
         (select had_update::text from _pre63), 'false'
  union all
  select 'b1 both stamps exist as nullable timestamptz',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'
             and column_name in ('edited_at','deleted_at')
             and data_type = 'timestamp with time zone' and is_nullable = 'YES'), '2'
  union all
  select 'b2 eight columns now',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_notes'), '8'
  union all
  select 'b3 update granted on the three columns',
         (select has_column_privilege('authenticated','vessl.program_notes','note','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','edited_at','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','deleted_at','UPDATE')::text),
         'true/true/true'
  union all
  select 'b4 and on none of the others',
         (select has_column_privilege('authenticated','vessl.program_notes','id','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','program_id','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','author','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','source','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.program_notes','created_at','UPDATE')::text),
         'false/false/false/false/false'
  union all
  select 'b5 the new policy is restrictive and for update',
         (select permissive || '/' || cmd from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname = 'notes_author_only_update'), 'RESTRICTIVE/UPDATE'
  union all
  select 'b6 it tests the caller token address on both sides',
         (select (case when qual like '%auth.jwt%' and with_check like '%auth.jwt%' then 'both' else 'no' end)::text
            from pg_policies where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname = 'notes_author_only_update'), 'both'
  union all
  select 'b7 two policies now, staff_only still there',
         (select count(*)::text from pg_policies
           where schemaname = 'vessl' and tablename = 'program_notes'
             and policyname in ('staff_only','notes_author_only_update')), '2'
  union all
  -- NO DELETE APPEARED, and no table level write either. Compared with the ACL as
  -- it was rather than with a written literal, so a grant somewhere else cannot
  -- fail a correct run.
  select 'b8 the table grants are exactly as they were',
         (select (case when (select relacl::text from pg_class where oid = 'vessl.program_notes'::regclass)
                            = (select acl_before from _pre63) then 'same' else 'changed' end)::text), 'same'
  union all
  select 'c1 no note row created or removed',
         (select ((select count(*) from vessl.program_notes) - (select notes_before from _pre63))::text), '0'
  union all
  select 'c2 programs untouched',
         (select ((select count(*) from vessl.programs) - (select programs_before from _pre63))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
