-- 73 -- DELETE on vessl.programs for authenticated, and for nobody else.
--
-- WHY THIS EXISTS. A PLM card cannot be removed from the Programs page, and the
-- reported bug is that deleting one does nothing. The board offers stage, owner,
-- notes and export, and no control that deletes a row. Nothing in the codebase
-- deletes a program either, so the report describes an absence rather than a
-- broken handler. This script closes the half of that absence which lives in the
-- database, so that a delete written later fails for no reason of its own.
--
-- A MISSING GRANT DOES NOT FAIL SILENTLY, which is worth saying because the bug
-- report assumed it might. Postgres raises 42501 permission denied for table
-- programs and the client returns it as an error. Silence comes from ROW LEVEL
-- SECURITY filtering rows to none, which returns success and no error at all.
-- The silence reported here is the missing control, not a swallowed message.
--
-- MEASURED BEFORE WRITING, against the live database.
--   vessl.programs relacl is authenticated=arw/postgres. a is INSERT, r is
--   SELECT, w is UPDATE, and the d for DELETE is absent.
--   has_table_privilege for authenticated on DELETE reads false. SELECT, INSERT
--   and UPDATE all read true. anon reads false on DELETE.
--   RLS is enabled and not forced. One permissive policy, staff_only, for ALL
--   commands, with vessl.is_staff() on both USING and WITH CHECK. The policy
--   already permits a delete that the grant never lets reach it.
--   program_notes carries the only foreign key to programs. Its confdeltype is
--   c, so notes go with the card. program_notes holds 0 rows.
--   programs holds 2 rows, 0 of them archived.
--
-- THE DEVIATION IS THE PART TO SETTLE BEFORE RUNNING THIS. The vessl schema
-- carries an ALTER DEFAULT PRIVILEGES granting authenticated arwdDxtm on new
-- tables, measured in pg_default_acl. programs holds only arw, so the d is
-- absent by deviation from that default rather than because the default
-- withholds it. Either the table predates the default privileges or DELETE was
-- taken away on purpose. PLM is a board kept by hand, where the settled habit is
-- that a card is archived rather than removed, so a deliberate revoke is a real
-- possibility. Granting back something deliberately withheld is the one outcome
-- nobody wants, and that question is for a person rather than for this script.
--
-- REVOKE FIRST, FROM THE ROLES THAT MUST NEVER HOLD IT. anon is the role behind
-- the key embedded in the browser bundle, and PUBLIC includes anon. Revoking
-- both before granting is the lesson scripts 21 and 34 paid for. b2 asserts the
-- end state rather than trusting the revokes above it.
--
-- WHAT A DELETE WILL MEAN once this is committed. A card and its general notes
-- go together and do not come back. The cascade is already in place and this
-- script does not alter it, so nothing here changes what a delete destroys --
-- only who is allowed to ask for one.

begin;

-- PRE-STATE FIRST, so a0 and a1 describe what was there rather than what this
-- script just did.
create temp table _pre73 on commit drop as
  select has_table_privilege('authenticated', 'vessl.programs', 'DELETE')::text as auth_delete_before,
         has_table_privilege('authenticated', 'vessl.programs', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.programs', 'INSERT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.programs', 'UPDATE')::text as auth_other_before,
         has_table_privilege('anon', 'vessl.programs', 'DELETE')::text          as anon_delete_before,
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) as relacl_before,
         (select count(*) from vessl.programs)::text                            as programs_before,
         (select count(*) from vessl.program_notes)::text                       as notes_before;

revoke delete on table vessl.programs from public;
revoke delete on table vessl.programs from anon;

grant delete on table vessl.programs to authenticated;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 authenticated could not delete before this script' as chk,
         (select auth_delete_before::text from _pre73) as got, 'false' as want
  union all
  select 'a1 the other three privileges were already held',
         (select auth_other_before::text from _pre73), 'true/true/true'
  union all
  select 'a2 anon could not delete before this script either',
         (select anon_delete_before::text from _pre73), 'false'
  union all
  select 'a3 the acl before this script carried no d',
         (select relacl_before::text from _pre73), '{postgres=arwdDxtm/postgres,authenticated=arw/postgres}'
  union all
  select 'b1 authenticated may delete now',
         has_table_privilege('authenticated', 'vessl.programs', 'DELETE')::text, 'true'
  union all
  -- THE ONE THAT MATTERS MOST. The anon key ships in the browser bundle, so if
  -- this ever reads true the whole board is deletable by anybody who finds it.
  select 'b2 anon still may NOT delete',
         has_table_privilege('anon', 'vessl.programs', 'DELETE')::text, 'false'
  union all
  select 'b3 select insert and update are unchanged by this script',
         has_table_privilege('authenticated', 'vessl.programs', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.programs', 'INSERT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.programs', 'UPDATE')::text,
         (select auth_other_before::text from _pre73)
  union all
  -- A GRANT MOVES NO ROWS, asserted rather than assumed, because this script
  -- runs against a live board rather than an empty one.
  select 'b4 no row in either table was touched',
         (select count(*) from vessl.programs)::text || '/' ||
         (select count(*) from vessl.program_notes)::text,
         (select programs_before || '/' || notes_before from _pre73)
  union all
  -- The cascade is what makes a delete destroy more than the card. Asserted so
  -- that granting the privilege and changing what it costs stay separate acts.
  select 'b5 notes still cascade with the card, unchanged',
         (select con.confdeltype::text from pg_constraint con
            join pg_class tgt on tgt.oid = con.confrelid
            join pg_namespace n on n.oid = tgt.relnamespace
           where con.contype = 'f' and n.nspname = 'vessl'
             and tgt.relname = 'programs'
             and con.conrelid = 'vessl.program_notes'::regclass), 'c'
  union all
  select 'b6 the staff policy still covers all commands',
         (select pol.polcmd::text || '/' || pol.polpermissive::text from pg_policy pol
           where pol.polrelid = 'vessl.programs'::regclass
             and pol.polname = 'staff_only'), '*/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
