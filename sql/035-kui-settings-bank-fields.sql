-- 35 -- split the ACH blob into six bank columns on vessl.kui_settings.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
-- Six columns in, one out. ach_info was a single textarea whose contents were
-- typed as free text and printed verbatim on a client quote sheet. It becomes six
-- labelled fields so the sheet can render them as labelled lines and skip the
-- ones left blank, which a blob cannot do.
--
-- ach_info IS DROPPED, NOT KEPT. Measured immediately before writing this script,
-- kui_settings holds 0 rows and 0 rows with a non-empty ach_info -- the table was
-- created 2026-09-08 by script 34 and nothing has ever been saved into it. So
-- there is no data to migrate and nothing to preserve. Keeping the column would
-- leave a second place for payment details to live, and the whole point of the
-- six fields is that there is one place each. a1 asserts the table is still empty
-- rather than trusting that measurement, so if somebody has typed real bank
-- details in between, this script REFUSES rather than dropping them.
--
-- ── NAMING, and the collision that forced it ─────────────────────────────────
-- All six carry a bank_ prefix. That is not tidiness -- the table already has an
-- address column holding the COMPANY address, and the new field is the BANK
-- address. Unprefixed they would be address and bank_address, a pair nobody can
-- keep straight in a form or a print template. Prefixing all six keeps them one
-- family rather than five plain names beside one prefixed oddity.
--
-- ── RLS IS DELIBERATELY UNTOUCHED, AND THIS WAS CHECKED ──────────────────────
-- Script 34 set read for every authenticated user, insert and update for admin
-- and staff, and no DELETE policy. Those are still exactly right for the new
-- shape and this script changes NONE of them. Stated here so the next reader
-- knows it was considered and rejected, not overlooked.
--
-- Adding a column does not alter a policy. All three policies are table-wide --
-- read is using (true), write is vessl.can_write_settings() -- and none of them
-- names a column, so six new columns inherit the existing rules with nothing to
-- do. Verified all the same. c1 asserts the three policies are still there and
-- still those commands, and c2 asserts there is still no DELETE policy, because
-- the point of a check is to prove the end state rather than to assume that an
-- unrelated statement was harmless.
--
-- The GRANT is likewise untouched and likewise asserted. Script 34 had to revoke
-- the schema default before granting, and column-level privileges do not enter
-- into it -- the grant is table-wide, so new columns are covered. c3 re-asserts
-- select insert update yes, delete no.
--
-- ── ONE OPERATIONAL WARNING ──────────────────────────────────────────────────
-- Between this script committing and the new code deploying, the OLD Company form
-- in production still sends ach_info on Save, and that column will be gone, so a
-- save would error. In practice nothing is lost -- that form has never had a
-- working save, the table has no rows, and only the admin account can currently
-- reach the tab. Worth knowing rather than discovering.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- kui_settings holds 0 rows. 9 columns -- id, company_name, contact_name, email,
-- phone, office_phone, address, ach_info, updated_at. Policies INSERT, SELECT,
-- UPDATE. After this script, 14 columns. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, before any DDL. A column check that runs after the alter can
-- only report what the alter just did.
create temp table _pre35 on commit drop as
  select (select count(*) from vessl.kui_settings)                     as rows_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings') as cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name = 'ach_info')                             as ach_info_before,
         (select count(*) from pg_policies
           where schemaname = 'vessl' and tablename = 'kui_settings')  as policies_before;

alter table vessl.kui_settings
  add column bank_name           text,
  add column bank_beneficiary    text,
  add column bank_account_number text,
  add column bank_routing_aba    text,
  add column bank_swift          text,
  add column bank_address        text;

-- Dropped last, so that if anything above fails the blob is still there.
alter table vessl.kui_settings drop column ach_info;

comment on table vessl.kui_settings is
  'Single row of company configuration, id 1 only. Read by every authenticated user because the client quote sheet prints from it. Written by admin and staff only. Never deleted. Bank details live in the six bank_ columns, one value each.';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 nine columns before, including ach_info' as chk,
         (select cols_before::text || '/' || ach_info_before::text from _pre35) as got,
         '9/1' as want
  union all
  -- THE GUARD ON THE DROP. If this is not 0, somebody has saved real bank details
  -- since the measurement and dropping ach_info would destroy them. The script
  -- fails here rather than in the alter, and nothing is committed.
  select 'a1 table was empty, so nothing was migrated',
         (select rows_before::text from _pre35), '0'
  union all
  select 'a2 three policies before, unchanged by this script',
         (select policies_before::text from _pre35), '3'
  union all
  select 'b1 fourteen columns now',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'), '14'
  union all
  select 'b2 all six bank columns present and text',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and data_type = 'text'
             and column_name in ('bank_name','bank_beneficiary','bank_account_number',
                                 'bank_routing_aba','bank_swift','bank_address')), '6'
  union all
  select 'b3 ach_info is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name = 'ach_info'), '0'
  union all
  -- The eight that were not touched. Named rather than counted, so dropping the
  -- wrong column shows up here instead of passing on arithmetic.
  select 'b4 the eight original columns are all still there',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name in ('id','company_name','contact_name','email','phone',
                                 'office_phone','address','updated_at')), '8'
  union all
  select 'b5 the single-row check constraint survived',
         (select count(*)::text from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'kui_settings' and con.contype = 'c'), '1'
  union all
  select 'b6 row level security is still on',
         (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'kui_settings'), 'true'
  union all
  -- RLS UNCHANGED, ASSERTED RATHER THAN ASSUMED.
  select 'c1 the same three policies, same commands',
         (select string_agg(cmd, ', ' order by cmd) from pg_policies
           where schemaname = 'vessl' and tablename = 'kui_settings'), 'INSERT, SELECT, UPDATE'
  union all
  select 'c2 still no DELETE policy',
         (select count(*)::text from pg_policies
           where schemaname = 'vessl' and tablename = 'kui_settings' and cmd = 'DELETE'), '0'
  union all
  select 'c3 the grant still covers the new columns and still excludes delete',
         (select has_table_privilege('authenticated', 'vessl.kui_settings', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'INSERT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'UPDATE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'DELETE')::text),
         'true/true/true/false'
  union all
  select 'c4 can_write_settings is still there and still security definer',
         (select p.prosecdef::text || '/' || p.provolatile::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'can_write_settings'), 'true/s'
  union all
  select 'd1 still empty, this script inserted nothing',
         (select count(*)::text from vessl.kui_settings), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
