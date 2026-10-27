-- 34 v2 -- create vessl.kui_settings, the single row of company configuration.
--
-- ── WHY THERE IS A v2 ────────────────────────────────────────────────────────
-- Rehearsal 1 returned two rows. z0 ran, and c1 failed reading true/true/true/
-- TRUE -- authenticated held DELETE on a table this script never granted DELETE
-- on. Nothing was committed.
--
-- The cause is a schema-level default. pg_default_acl carries, for schema vessl
-- and object type table, authenticated=arwdDxtm/postgres. Every new table in the
-- schema is created with all seven privileges already granted to authenticated,
-- so the grant of three added nothing and the absence of a DELETE grant meant
-- nothing either. v2 revokes everything first and then grants back the three.
--
-- THE LESSON, which generalises past this script. A privilege you did not grant
-- is not a privilege the role does not have. The same is true of the policy
-- layer in reverse -- a permissive policy somewhere else ORs with yours. Assert
-- the END STATE from the catalogue rather than reasoning forward from the
-- statements written, which is what c1 did, which is why this was caught in
-- rehearsal instead of in production.
--
-- ── WHAT ALREADY EXISTS, which is more than it looks ─────────────────────────
-- The CODE IS ALREADY WRITTEN. page.jsx CompanySettings loads id 1 and upserts
-- id 1, and quotes.jsx printClientSheet already reads the row and already gates
-- the payment block on ach_info being non-empty. Both were built against a table
-- that was never created, which is why the form carries a Not connected yet
-- notice. This script creates what they were written for. The only code change
-- that follows is deleting that notice.
--
-- So the COLUMN LIST IS NOT A DESIGN CHOICE, it is dictated by an upsert that
-- already ships. CompanySettings sends exactly id, company_name, contact_name,
-- email, phone, office_phone, address, ach_info and updated_at. A column missing
-- here is a failed save; a column here that the form never sends is harmless but
-- pointless. The list below is that payload and nothing else.
--
-- ── THE SINGLE ROW ───────────────────────────────────────────────────────────
-- id is integer, primary key, default 1, with a CHECK that it equals 1. The
-- default alone would not stop a second row, and the primary key alone would not
-- stop id 2, so it takes both plus the check to make the table structurally
-- incapable of holding two rows of company details.
--
-- NOT SEEDED. The table is created empty and the first Save inserts the row,
-- which is also the only thing that exercises the INSERT policy in real use. An
-- empty table is what the form already expects -- its load falls back to blank
-- defaults when the select returns nothing.
--
-- ── RLS, AS DECIDED ──────────────────────────────────────────────────────────
-- READ for every authenticated user. The client quote sheet prints from this row
-- and anyone who can print a sheet needs it, so read is deliberately not
-- restricted to the roles that can edit.
--
-- INSERT and UPDATE for role admin or staff only, matching the Settings tab
-- allowlist exactly, so limited_qc can neither see the tab nor write the row.
--
-- NO DELETE POLICY, AND NO DELETE PRIVILEGE. This row is updated, never deleted,
-- and saying so at both layers is deliberate. RLS with no permissive DELETE
-- policy already denies every delete, and taking the table privilege away means
-- the attempt is refused a layer earlier. Every other vessl table holds the full
-- arwdDxtm set for authenticated and leans entirely on RLS -- not by choice, but
-- because that is what the schema default grants and nobody has revoked it. This
-- table is the first that does not.
--
-- vessl.can_write_settings() IS A NEW FUNCTION AND MIRRORS vessl.is_staff()
-- deliberately, adding only the role filter. is_staff returns true for ANY row in
-- staff_profiles including limited_qc, so it is the wrong test here. The mirrored
-- part that matters is the OR on email. Of the 7 profiles, ONE HAS A NULL
-- auth_user_id, so a check written only against auth.uid() would lock that person
-- out of a tab they are entitled to. SECURITY DEFINER and a pinned search_path,
-- both copied from is_staff, because the function reads a table the caller may
-- not be able to read.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- kui_settings does not exist in ANY schema at ANY relkind. can_write_settings
-- does not exist. staff_profiles holds 7 rows -- 1 admin, 5 staff, 1 limited_qc
-- -- so 6 will be able to write and 1 will not, and 1 of the 7 has a null
-- auth_user_id. pg_default_acl grants authenticated arwdDxtm on every new vessl
-- table, which is why the revoke exists. Rehearsal z0, commit z0.
--
-- ── THE CHECK CONSTRAINT IS ASSERTED FROM THE CATALOGUE, NOT BY TRIPPING IT ──
-- Proving id 2 is refused means causing an error, and a failed statement poisons
-- the whole transaction unless it is wrapped in savepoint handling that behaves
-- differently in every client. So the rehearsal asserts the constraint EXISTS and
-- the behaviour test runs after commit, outside the transaction, where a rejected
-- insert costs nothing. That test is in 034-after-commit-checks.sql, a separate
-- file because those lines carry quotes and a quote inside a comment is what
-- broke script 23 in this client.

begin;

-- PRE-STATE FIRST, captured before the DDL runs. A check that reads the live
-- catalogue after the table is created can only ever report the table exists,
-- which proves nothing about what was there before. Script 33 lost three
-- rehearsals to a guard that ran in the wrong place.
create temp table _pre34 on commit drop as
  select (select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where c.relname = 'kui_settings')                    as tbl_before,
         (select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where p.proname = 'can_write_settings')              as fn_before,
         -- The thing that broke rehearsal 1. Captured rather than described, so
         -- the day somebody removes the default privilege this check says so and
         -- the revoke below can be reconsidered instead of cargo-culted.
         (select count(*) from pg_default_acl d
            join pg_namespace n on n.oid = d.defaclnamespace
           where n.nspname = 'vessl' and d.defaclobjtype = 'r') as default_acl_before;

create table vessl.kui_settings (
  id            integer primary key default 1,
  company_name  text,
  contact_name  text,
  email         text,
  phone         text,
  office_phone  text,
  address       text,
  ach_info      text,
  updated_at    timestamptz default now(),
  constraint kui_settings_single_row check (id = 1)
);

comment on table vessl.kui_settings is
  'Single row of company configuration, id 1 only. Read by every authenticated user because the client quote sheet prints from it. Written by admin and staff only. Never deleted.';

-- Mirrors vessl.is_staff() and adds the role filter. The OR on email is not
-- decoration -- one staff_profiles row has a null auth_user_id.
create or replace function vessl.can_write_settings()
returns boolean
language sql
stable
security definer
set search_path to 'vessl', 'public'
as $fn$
  select exists (
    select 1 from vessl.staff_profiles sp
     where sp.role in ('admin', 'staff')
       and (sp.auth_user_id = auth.uid()
            or lower(sp.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$fn$;

alter table vessl.kui_settings enable row level security;

-- Read is open to every authenticated user, because printing a client sheet
-- requires it and printing is not restricted to the roles that can edit.
create policy kui_settings_read on vessl.kui_settings
  for select to authenticated
  using (true);

create policy kui_settings_insert on vessl.kui_settings
  for insert to authenticated
  with check (vessl.can_write_settings());

create policy kui_settings_update on vessl.kui_settings
  for update to authenticated
  using (vessl.can_write_settings())
  with check (vessl.can_write_settings());

-- REVOKE FIRST, AND THIS IS THE CORRECTION THAT MADE v2. The first rehearsal
-- failed here, on c1, reading true/true/true/TRUE. The schema carries an ALTER
-- DEFAULT PRIVILEGES that grants authenticated the full arwdDxtm set on every new
-- table, applied at CREATE time, so the table arrived with DELETE already on it
-- and a grant of three privileges added nothing. Measured in pg_default_acl --
-- schema vessl, object type table, authenticated=arwdDxtm/postgres.
--
-- NOT GRANTING A PRIVILEGE IS NOT THE SAME AS NOT HAVING IT. Withholding DELETE
-- only works against a schema whose default is to withhold, and this one grants
-- everything. So revoke the lot, then grant back exactly the three that are
-- wanted. The revoke also clears TRUNCATE, REFERENCES and TRIGGER, none of which
-- PostgREST needs and all of which the default handed over.
revoke all on vessl.kui_settings from authenticated;
grant select, insert, update on vessl.kui_settings to authenticated;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 table did not exist before this script' as chk,
         (select tbl_before::text from _pre34) as got, '0' as want
  union all
  select 'a1 function did not exist before this script',
         (select fn_before::text from _pre34), '0'
  union all
  -- If this ever reads 0, the schema default has been removed and the revoke
  -- below is no longer load-bearing. It is load-bearing today.
  select 'a2 schema grants authenticated everything on new tables',
         (select default_acl_before::text from _pre34), '1'
  union all
  select 'b1 table exists now, exactly one of it',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'kui_settings' and c.relkind = 'r'), '1'
  union all
  -- The nine the form sends. Counted by name, so a typo in one is a miss rather
  -- than a total that happens to add up.
  select 'b2 all nine columns the form upserts are present',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name in ('id','company_name','contact_name','email','phone',
                                 'office_phone','address','ach_info','updated_at')), '9'
  union all
  select 'b3 and no columns beyond those nine',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'), '9'
  union all
  select 'b4 exactly one check constraint, the single-row guard',
         (select count(*)::text from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'kui_settings' and con.contype = 'c'), '1'
  union all
  select 'b5 row level security is on',
         (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'kui_settings'), 'true'
  union all
  select 'b6 three policies, and their commands are exactly these',
         (select string_agg(cmd, ', ' order by cmd) from pg_policies
           where schemaname = 'vessl' and tablename = 'kui_settings'), 'INSERT, SELECT, UPDATE'
  union all
  -- Stated as its own check rather than inferred from b6, because this is the
  -- decision most likely to be undone by accident later.
  select 'b7 no DELETE policy exists',
         (select count(*)::text from pg_policies
           where schemaname = 'vessl' and tablename = 'kui_settings' and cmd = 'DELETE'), '0'
  union all
  select 'b8 the function exists, security definer and stable',
         (select p.prosecdef::text || '/' || p.provolatile::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'can_write_settings'), 'true/s'
  union all
  -- Read, insert, update yes. Delete no, at the privilege layer as well as the
  -- policy layer.
  select 'c1 authenticated holds select insert update but not delete',
         (select has_table_privilege('authenticated', 'vessl.kui_settings', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'INSERT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'UPDATE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'DELETE')::text),
         'true/true/true/false'
  union all
  -- Who the function will admit, measured from the data it reads. Not a test of
  -- the function itself, which needs a real session to evaluate auth.uid().
  select 'c2 six profiles may write, one may not',
         (select count(*) filter (where role in ('admin', 'staff'))::text || '/' ||
                 count(*) filter (where role = 'limited_qc')::text
            from vessl.staff_profiles), '6/1'
  union all
  -- The other three the schema default handed over. PostgREST needs none of
  -- them, and leaving them would mean the revoke had only half worked.
  select 'c3 truncate, references and trigger are gone too',
         (select has_table_privilege('authenticated', 'vessl.kui_settings', 'TRUNCATE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'REFERENCES')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.kui_settings', 'TRIGGER')::text),
         'false/false/false'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
