-- 36 -- vessl.payment_accounts, plus quotes.payment_account_id.
--
-- ── WHAT IT DOES ─────────────────────────────────────────────────────────────
-- One bank account becomes many. payment_accounts holds a label and the same six
-- bank_ columns kui_settings already has, so lib/bankFields.js is reused
-- unchanged by both the form and the printed sheet. quotes gains a nullable
-- payment_account_id where NULL means USE THE DEFAULT, so every existing quote
-- and every untouched picker resolves without a backfill.
--
-- ── THE SEED COPIES, IT DOES NOT INVENT ──────────────────────────────────────
-- The Primary row is populated by SELECTING FROM kui_settings AT RUN TIME rather
-- than from values written into this file. Real bank details are being entered
-- into that form today, and this script is being written before they land, so
-- literals here would be wrong by the time it runs -- and would also put an
-- account number in a file and in a terminal, which is reason enough on its own.
-- Nothing below prints a bank value. b6 proves the copy by COMPARING columns and
-- returning a count.
--
-- a3 IS AN ORDERING GUARD, and it is the one check that is safe to remove. It
-- asserts the source actually carries bank detail, because seeding a blank
-- default would later produce no payment block at all -- which on a client sheet
-- is indistinguishable from a sheet that was never meant to have one. If the
-- decision changes and this needs to run before the details are typed, delete the
-- a3 branch and its union all. Nothing else depends on it.
--
-- ── AT MOST ONE DEFAULT IS ENFORCED. AT LEAST ONE IS NOT ─────────────────────
-- The partial unique index makes a second is_default row impossible. Postgres
-- cannot express the other half as a simple constraint -- guaranteeing a default
-- always EXISTS needs a trigger or a deferred constraint, and both are heavier
-- than the problem. It is held instead by three things together. The seed creates
-- one, there is no DELETE policy so it cannot be removed, and the code must set
-- the new default before clearing the old. THE THIRD IS THE WEAK ONE and is
-- worth a check in whatever ships next, because a NULL payment_account_id with no
-- default resolves to nothing and prints nothing, silently.
--
-- ── active, BECAUSE THERE IS NO DELETE ───────────────────────────────────────
-- A single-row config table never needed retirement. A list does -- a closed bank
-- account has to leave the picker without breaking quotes that point at it, and
-- with no DELETE policy the only other exit is blanking the fields, which
-- corrupts every quote referencing it. active mirrors products.active, the
-- existing precedent, and the picker filters on it while the resolver ignores it
-- so an archived account still prints correctly on an old quote.
--
-- ── RLS, SAME INTENT AS SCRIPT 34 ────────────────────────────────────────────
-- Read for every authenticated user because the client sheet prints from it.
-- Insert and update for admin and staff via vessl.can_write_settings(), REUSED
-- rather than duplicated -- one definition of who may write company money detail.
-- No DELETE policy.
--
-- AND THE REVOKE COMES FIRST, which is the lesson script 34 paid for. The schema
-- carries an ALTER DEFAULT PRIVILEGES granting authenticated the full arwdDxtm
-- set on every new table at CREATE time, so not granting DELETE does not withhold
-- it. Revoke everything, grant back three. c4 asserts the end state rather than
-- trusting the statements above it.
--
-- ── kui_settings IS NOT TOUCHED ──────────────────────────────────────────────
-- Not read-and-cleared, not dropped, not altered. It stays exactly as it is
-- through this release so a rollback needs no database change, and script 37
-- removes the six columns later once the new path is proven in production. c5
-- asserts this script left it alone, by comparing the six columns against a
-- snapshot taken before any DDL ran.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- payment_accounts does not exist in any schema at any relkind. quotes holds 330
-- rows and 41 columns and has no payment_account_id. kui_settings holds exactly
-- one row. quotes.product_id is the precedent for a nullable uuid FK added to
-- this table. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, before any DDL, including a copy of the six source columns so
-- c5 can prove they came through untouched.
create temp table _pre36 on commit drop as
  select (select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where c.relname = 'payment_accounts')                        as tbl_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes'
             and column_name = 'payment_account_id')                    as col_before,
         (select count(*) from vessl.quotes)                            as quotes_before,
         (select count(*) from vessl.kui_settings)                      as settings_rows_before;

create temp table _src36 on commit drop as
  select bank_name, bank_beneficiary, bank_account_number,
         bank_routing_aba, bank_swift, bank_address
    from vessl.kui_settings where id = 1;

create table vessl.payment_accounts (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null,
  bank_name           text,
  bank_beneficiary    text,
  bank_account_number text,
  bank_routing_aba    text,
  bank_swift          text,
  bank_address        text,
  is_default          boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table vessl.payment_accounts is
  'Bank accounts a quote can be paid into. Exactly one row carries is_default, enforced by a partial unique index. Rows are retired with active rather than deleted. Read by every authenticated user because the client quote sheet prints from it; written by admin and staff only.';

-- AT MOST ONE DEFAULT. Only is_default true rows are indexed, and every indexed
-- value is the same, so a second one collides.
create unique index payment_accounts_single_default
  on vessl.payment_accounts (is_default) where is_default;

-- THE SEED, copied from the live row rather than written here.
insert into vessl.payment_accounts
  (label, bank_name, bank_beneficiary, bank_account_number,
   bank_routing_aba, bank_swift, bank_address, is_default, active)
select 'Primary', s.bank_name, s.bank_beneficiary, s.bank_account_number,
       s.bank_routing_aba, s.bank_swift, s.bank_address, true, true
  from _src36 s;

-- NULL means use the default. No backfill, and that is the point -- 330 existing
-- quotes resolve correctly by holding nothing at all.
alter table vessl.quotes
  add column payment_account_id uuid references vessl.payment_accounts(id);

comment on column vessl.quotes.payment_account_id is
  'Which payment account this quote is paid into. NULL means use the default account, which is how every quote written before this column behaves.';

alter table vessl.payment_accounts enable row level security;

create policy payment_accounts_read on vessl.payment_accounts
  for select to authenticated
  using (true);

create policy payment_accounts_insert on vessl.payment_accounts
  for insert to authenticated
  with check (vessl.can_write_settings());

create policy payment_accounts_update on vessl.payment_accounts
  for update to authenticated
  using (vessl.can_write_settings())
  with check (vessl.can_write_settings());

-- Revoke first. The schema default already granted everything at CREATE time.
revoke all on vessl.payment_accounts from authenticated;
grant select, insert, update on vessl.payment_accounts to authenticated;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 payment_accounts did not exist before this script' as chk,
         (select tbl_before::text from _pre36) as got, '0' as want
  union all
  select 'a1 quotes had no payment_account_id before this script',
         (select col_before::text from _pre36), '0'
  union all
  select 'a2 kui_settings holds exactly one row to copy from',
         (select settings_rows_before::text from _pre36), '1'
  union all
  -- THE ORDERING GUARD. Delete this branch and its union all if the details are
  -- deliberately being entered after this runs.
  select 'a3 the source row actually carries bank detail',
         (select case when coalesce(bank_name,'') || coalesce(bank_beneficiary,'')
                        || coalesce(bank_account_number,'') || coalesce(bank_routing_aba,'')
                        || coalesce(bank_swift,'') || coalesce(bank_address,'') <> ''
                      then 'yes' else 'no' end from _src36), 'yes'
  union all
  select 'b1 the table exists now',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'payment_accounts' and c.relkind = 'r'), '1'
  union all
  select 'b2 twelve columns, exactly the ones named',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'payment_accounts'
             and column_name in ('id','label','bank_name','bank_beneficiary','bank_account_number',
                                 'bank_routing_aba','bank_swift','bank_address',
                                 'is_default','active','created_at','updated_at')), '12'
  union all
  select 'b3 and no columns beyond those twelve',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'payment_accounts'), '12'
  union all
  select 'b4 the partial unique index on is_default exists',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'payment_accounts'
             and indexname = 'payment_accounts_single_default'), '1'
  union all
  select 'b5 exactly one account, and it is the default and active',
         (select count(*)::text || '/' ||
                 count(*) filter (where is_default)::text || '/' ||
                 count(*) filter (where active)::text
            from vessl.payment_accounts), '1/1/1'
  union all
  -- THE COPY, PROVEN BY COMPARISON rather than by printing anything. is not
  -- distinct from, so a NULL source column matches a NULL seeded one.
  select 'b6 all six bank columns match the source row',
         (select count(*)::text from vessl.payment_accounts p, _src36 s
           where p.bank_name           is not distinct from s.bank_name
             and p.bank_beneficiary    is not distinct from s.bank_beneficiary
             and p.bank_account_number is not distinct from s.bank_account_number
             and p.bank_routing_aba    is not distinct from s.bank_routing_aba
             and p.bank_swift          is not distinct from s.bank_swift
             and p.bank_address        is not distinct from s.bank_address), '1'
  union all
  select 'b7 quotes gained payment_account_id',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes'
             and column_name = 'payment_account_id'), '1'
  union all
  -- Stated as a DIFFERENCE, not as 330 of 330. The row count was 330 when this
  -- was written and quotes are added daily, so an absolute want would fail on a
  -- perfectly good run for a reason that has nothing to do with the script.
  select 'b8 no quote carries an account, so every quote uses the default',
         (select (count(*) - count(*) filter (where payment_account_id is null))::text
            from vessl.quotes), '0'
  union all
  select 'b9 quote row count unchanged, before and after',
         (select ((select count(*) from vessl.quotes) - (select quotes_before from _pre36))::text), '0'
  union all
  select 'c1 the foreign key exists and points at payment_accounts',
         (select count(*)::text from pg_constraint con
            join pg_class c  on c.oid  = con.conrelid
            join pg_class rc on rc.oid = con.confrelid
           where con.contype = 'f' and c.relname = 'quotes'
             and rc.relname = 'payment_accounts'), '1'
  union all
  select 'c2 row level security is on',
         (select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'payment_accounts'), 'true'
  union all
  select 'c3 three policies, and no DELETE among them',
         (select string_agg(cmd, ', ' order by cmd) from pg_policies
           where schemaname = 'vessl' and tablename = 'payment_accounts'), 'INSERT, SELECT, UPDATE'
  union all
  select 'c4 authenticated holds select insert update but not delete',
         (select has_table_privilege('authenticated', 'vessl.payment_accounts', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.payment_accounts', 'INSERT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.payment_accounts', 'UPDATE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.payment_accounts', 'DELETE')::text),
         'true/true/true/false'
  union all
  -- kui_settings LEFT ALONE, compared against the snapshot rather than assumed.
  select 'c5 the source row is unchanged by this script',
         (select count(*)::text from vessl.kui_settings k, _src36 s
           where k.id = 1
             and k.bank_name           is not distinct from s.bank_name
             and k.bank_beneficiary    is not distinct from s.bank_beneficiary
             and k.bank_account_number is not distinct from s.bank_account_number
             and k.bank_routing_aba    is not distinct from s.bank_routing_aba
             and k.bank_swift          is not distinct from s.bank_swift
             and k.bank_address        is not distinct from s.bank_address), '1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
