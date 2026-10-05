-- 76 -- vessl.program_tasks, the per-stage checklist.
--
-- WHAT IT DOES. Creates the table the card checklist writes to, grants
-- authenticated exactly four privileges on it, turns RLS on and adds the one
-- staff policy. Nothing else gains anything.
--
-- THE TABLE EXISTED ONCE AND WAS DROPPED. The 11 Aug board kept a checklist per
-- stage and it went with the rework. This recreates it on the model the rest of
-- the schema now uses -- an owner is a staff_profiles id rather than an email
-- string, and the program is a foreign key that cascades.
--
-- ── THE DEFAULT PRIVILEGES ARE THE DANGEROUS PART ───────────────────────────
-- The vessl schema carries an ALTER DEFAULT PRIVILEGES granting authenticated
-- arwdDxtm on new relations, measured in pg_default_acl. A table created the
-- obvious way therefore arrives with INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER already handed out -- including the power to empty the
-- table in one statement.
--
-- So everything is revoked first and then four privileges are granted back. This
-- is the same lesson scripts 21 and 34 paid for, and b2 asserts the end state
-- rather than trusting the revoke above it. NOT GRANTING IS NOT THE SAME AS NOT
-- GRANTED.
--
-- NO AUTHOR POLICY, AND THAT IS DELIBERATE. program_notes carries two RESTRICTIVE
-- policies confining edits and deletes to the person who wrote the row, because a
-- note is somebody words. A task is shared work -- the whole point of a checklist
-- is that anybody on the team can tick an item off, reassign it or clear it -- so
-- the only rule here is the staff gate. If that ever needs narrowing, the two
-- policies on program_notes are the shape to copy.
--
-- ON DELETE CASCADE, matching program_notes. A task belongs to a card and has no
-- meaning without one, and a card cannot be deleted today in any case -- the
-- board archives instead, and authenticated holds no DELETE on programs.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.program_tasks does not exist.
--   pg_default_acl for relations in vessl reads authenticated=arwdDxtm/postgres.
--   vessl.program_notes, the shape being followed, reads authenticated=ard plus
--     a column level UPDATE, with one permissive staff_only policy and two
--     restrictive author-only ones.
--   vessl.is_staff() exists and is the gate every other policy in this schema
--     uses.

begin;

-- PRE-STATE FIRST, before the table exists, so a0 describes what was there
-- rather than what this script just did.
create temp table _pre76 on commit drop as
  select (select count(*) from information_schema.tables
           where table_schema = 'vessl' and table_name = 'program_tasks')            as table_before,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'is_staff')                      as is_staff_before,
         (select da.defaclacl::text from pg_default_acl da
            join pg_namespace n on n.oid = da.defaclnamespace
           where n.nspname = 'vessl' and da.defaclobjtype = 'r')                      as default_acl_before;

do $guard$
begin
  if (select table_before from _pre76) <> 0 then
    raise exception 'vessl.program_tasks already exists, nothing changed';
  end if;
  if (select is_staff_before from _pre76) <> 1 then
    raise exception 'vessl.is_staff does not exist, so the policy below would gate on nothing, nothing changed';
  end if;
end
$guard$;

create table vessl.program_tasks (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references vessl.programs(id) on delete cascade,
  -- The same six the ladder allows. A task belongs to the stage it was raised
  -- in, and the card reads the current stage list against this column.
  stage       text not null
              check (stage in ('quoted','sampling','revision','testing','production','shipped')),
  task        text not null check (btrim(task) <> ''),
  -- A KEY, NOT AN ADDRESS. programs.owner_id is a staff_profiles id for the
  -- reason a key cannot hold a typo, and a checklist owner is the same question.
  -- NULL is Unowned and is a real answer.
  owner_id    uuid references vessl.staff_profiles(id),
  -- An ADDRESS, not a key, and deliberately the other way round. This is an
  -- audit crumb that has to stay readable after somebody leaves and their
  -- profile goes, which is exactly what programs.updated_by is for.
  assigned_by text,
  due_date    date,
  blocker     text not null default 'none'
              check (blocker in ('none','factory','client','us')),
  done        boolean not null default false,
  done_at     timestamptz,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table vessl.program_tasks is
  'Per-stage checklist items on a PLM card. Seeded from the stage templates when a card advances, and added by hand on the card. Shared work -- anybody on staff may tick, reassign or remove any row, which is why there is no author policy here as there is on program_notes.';

-- The card reads every task for one program, and the board reads them all at
-- once to count blockers. Both start from program_id.
create index program_tasks_program_id_idx on vessl.program_tasks (program_id);

-- REVOKE BEFORE GRANTING. CREATE TABLE has already handed authenticated the full
-- arwdDxtm from the schema default, so this is taking back what was never asked
-- for rather than tidying.
revoke all on table vessl.program_tasks from public;
revoke all on table vessl.program_tasks from anon;
revoke all on table vessl.program_tasks from authenticated;

grant select, insert, update, delete on table vessl.program_tasks to authenticated;

alter table vessl.program_tasks enable row level security;

create policy staff_only on vessl.program_tasks
  for all to authenticated
  using (vessl.is_staff())
  with check (vessl.is_staff());

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the table did not exist before this script' as chk,
         (select table_before::text from _pre76) as got, '0' as want
  union all
  select 'a1 the schema default would have granted everything',
         (select default_acl_before::text from _pre76), '{authenticated=arwdDxtm/postgres}'
  union all
  select 'b1 the table exists now',
         (select count(*)::text from information_schema.tables
           where table_schema = 'vessl' and table_name = 'program_tasks'), '1'
  union all
  -- THE ONE THAT MATTERS MOST. Four privileges and no more -- in particular no
  -- TRUNCATE, which the schema default had already granted.
  select 'b2 authenticated holds exactly select insert update delete',
         (select relacl::text from pg_class where oid = 'vessl.program_tasks'::regclass),
         '{postgres=arwdDxtm/postgres,authenticated=arwd/postgres}'
  union all
  select 'b3 anon holds nothing at all',
         (select has_table_privilege('anon', 'vessl.program_tasks', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_tasks', 'INSERT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_tasks', 'UPDATE')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_tasks', 'DELETE')::text),
         'false/false/false/false'
  union all
  select 'b4 authenticated cannot truncate it',
         has_table_privilege('authenticated', 'vessl.program_tasks', 'TRUNCATE')::text, 'false'
  union all
  select 'b5 row level security is on',
         (select relrowsecurity::text from pg_class where oid = 'vessl.program_tasks'::regclass), 'true'
  union all
  select 'b6 one permissive staff policy for all commands',
         (select count(*)::text || '/' || max(pol.polcmd::text) || '/' || max(pol.polpermissive::text)
            from pg_policy pol where pol.polrelid = 'vessl.program_tasks'::regclass), '1/*/true'
  union all
  select 'b7 the policy gates on is_staff on both sides',
         (select (pg_get_expr(pol.polqual, pol.polrelid) = 'vessl.is_staff()'
              and pg_get_expr(pol.polwithcheck, pol.polrelid) = 'vessl.is_staff()')::text
            from pg_policy pol where pol.polrelid = 'vessl.program_tasks'::regclass), 'true'
  union all
  -- A task without a card is a row nobody can reach, so the cascade is part of
  -- the design rather than a convenience.
  select 'b8 the program key cascades on delete',
         (select con.confdeltype::text from pg_constraint con
           where con.conrelid = 'vessl.program_tasks'::regclass and con.contype = 'f'
             and con.confrelid = 'vessl.programs'::regclass), 'c'
  union all
  select 'b9 the owner key points at staff_profiles and does not cascade',
         (select con.confdeltype::text from pg_constraint con
           where con.conrelid = 'vessl.program_tasks'::regclass and con.contype = 'f'
             and con.confrelid = 'vessl.staff_profiles'::regclass), 'a'
  union all
  select 'c1 the table starts empty',
         (select count(*)::text from vessl.program_tasks), '0'
  union all
  select 'c2 program_notes is unchanged by this script',
         (select relacl::text from pg_class where oid = 'vessl.program_notes'::regclass),
         '{postgres=arwdDxtm/postgres,authenticated=ard/postgres}'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
