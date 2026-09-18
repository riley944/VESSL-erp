-- 66 -- sampling belongs to the product, not to the card.
--
-- WHAT IT DOES. Adds products.sample_date, and creates vessl.product_notes with
-- the grants and policies program_notes ended up with after 63 and 64.
--
-- WHY THE NOTES HANG OFF THE PRODUCT. A program is one product for one client, so
-- a note about how the sample went would be written on one card and invisible from
-- every other card for the same SKU -- and invisible from the Testing product
-- modal, where the people doing the sampling actually work. Sampling is a fact
-- about the product. The note follows the thing it is about.
--
-- kind IS A COLUMN WITH ONE VALUE TODAY, and a CHECK that permits only that value.
-- It is there because product_notes is obviously going to be asked for other kinds
-- of product note, and the alternative to a kind column is a second table with the
-- same six columns. The CHECK means a second kind is a deliberate widening rather
-- than a typo that quietly creates a category.
--
-- THE POLICIES MIRROR program_notes CHARACTER FOR CHARACTER, and b9 proves it by
-- comparing the stored expressions rather than by reading them. The rule is the
-- one 63 and 64 settled on -- your own rows only, matched on the token address,
-- with the empty author excluded so a row nobody signed belongs to nobody.
--
-- THE GRANT SPLIT IS THE SAME TOO. SELECT, INSERT and DELETE at table level;
-- UPDATE on note and edited_at ONLY, so a note cannot be reassigned to another
-- author or have its kind changed. There is no soft delete column, because 64
-- established that a note nobody can see and nobody can remove only accumulates.
--
-- ON DELETE CASCADE on the product, matching what program_notes does with its
-- program. Notes about a product that no longer exists are not a record anybody
-- can act on.
--
-- CREATE TABLE ALREADY GRANTS EVERYTHING HERE, and that is what the first
-- rehearsal found the hard way. The vessl schema carries default privileges --
-- read from pg_default_acl, postgres grants authenticated arwdDxtm on every new
-- table in this schema -- so product_notes arrived with full table rights on it
-- and the narrow grant below was a narrow grant beside a wide one. b6 and b7
-- failed, correctly. Everything is revoked first now, and only then granted.
--
-- anon AND PUBLIC ARE REVOKED TOO, as a guard rather than a repair. anon does not
-- appear in the vessl default -- the public schema grants it, vessl does not --
-- and anon holds nothing on program_notes, programs or products today, all
-- measured. The revoke and b12 exist so that a change to the schema default
-- cannot quietly open this table later.
--
-- service_role IS DELIBERATELY NOT NAMED. It is absent from the vessl default and
-- from every sibling table ACL, so there is nothing of its to take away, and a
-- revoke naming it would be a statement about a grant that does not exist.
--
-- NO PROBE FOR THE POLICIES, as in 63 and 64. The SQL editor runs as the table
-- owner and RLS does not apply to the owner, so a probe could only prove that
-- owners can do owner things. The GRANTS are tested for real, by
-- has_table_privilege and has_column_privilege, which answer for a named role.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.products -- 34 columns, 357 rows, no sample_date.
--   vessl.product_notes -- does not exist.
--   vessl.is_staff() exists. programs holds 1 row, program_notes holds 1 row.
--   pg_default_acl for vessl tables -- postgres grants authenticated arwdDxtm.
--   anon and service_role are absent from that default and hold nothing on
--   program_notes, programs or products.
--   program_notes relacl reads authenticated=ard, which is the shape this table
--   has to end up matching.

begin;

-- PRE-STATE FIRST, counted before anything is written.
create temp table _pre66 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products')            as product_cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'
             and column_name = 'sample_date')                                   as had_sample_date,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'product_notes')           as had_table,
         (select count(*) from vessl.products)                                  as products_before,
         (select count(*) from vessl.programs)                                  as programs_before,
         (select count(*) from vessl.program_notes)                             as program_notes_before,
         (select qual from pg_policies where schemaname = 'vessl'
           and tablename = 'program_notes' and policyname = 'notes_author_only_update') as author_expr;

-- REFUSE rather than build on a schema that is not the one measured.
do $guard$
begin
  if (select had_sample_date from _pre66) <> 0 then
    raise exception 'products already carries sample_date, nothing changed';
  end if;
  if (select had_table from _pre66) <> 0 then
    raise exception 'vessl.product_notes already exists, nothing changed';
  end if;
  if (select product_cols_before from _pre66) <> 34 then
    raise exception 'products is not the thirty four column table measured, nothing changed';
  end if;
  if (select author_expr from _pre66) is null then
    raise exception 'the program_notes author policy is missing, so there is nothing to mirror, nothing changed';
  end if;
end
$guard$;

-- 1. When the sample happened. A date rather than a timestamp, because somebody
--    types it from a conversation and an hour would be invented precision.
alter table vessl.products add column sample_date date;

-- 2. The notes themselves.
create table vessl.product_notes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references vessl.products(id) on delete cascade,
  kind       text not null default 'sampling',
  author     text,
  note       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  constraint product_notes_kind_check check (kind in ('sampling'))
);

create index product_notes_product_idx on vessl.product_notes (product_id);

alter table vessl.product_notes enable row level security;

-- 3. REVOKE WHAT CREATE TABLE ALREADY HANDED OUT. Without this the table carries
--    the schema default, authenticated with arwdDxtm, and every narrowing below
--    is decoration. Revoking is idempotent, so naming a role that holds nothing
--    costs nothing and says what this script intends.
revoke all on vessl.product_notes from public;
revoke all on vessl.product_notes from anon;
revoke all on vessl.product_notes from authenticated;

-- 4. Then the same grant split program_notes carries. UPDATE is per column, so
--    author, kind and created_at are unwritable by the application.
grant select, insert, delete on vessl.product_notes to authenticated;
grant update (note, edited_at) on vessl.product_notes to authenticated;

-- 5. The same three policies. staff_only is the permissive floor; the two
--    restrictive ones AND with it, which is the only shape that means your own
--    rows -- a second permissive policy would confine nothing.
create policy staff_only on vessl.product_notes
  as permissive for all to authenticated
  using (vessl.is_staff())
  with check (vessl.is_staff());

create policy product_notes_author_only_update on vessl.product_notes
  as restrictive for update to authenticated
  using (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  )
  with check (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );

create policy product_notes_author_only_delete on vessl.product_notes
  as restrictive for delete to authenticated
  using (
    coalesce(btrim(author), '') <> ''
    and lower(btrim(author)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 products had thirty four columns and no sample_date' as chk,
         (select product_cols_before::text || '/' || had_sample_date::text from _pre66) as got, '34/0' as want
  union all
  select 'a1 product_notes did not exist',
         (select had_table::text from _pre66), '0'
  union all
  select 'b1 sample_date exists as a nullable date',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'
             and column_name = 'sample_date' and data_type = 'date' and is_nullable = 'YES'), '1'
  union all
  select 'b2 products has thirty five columns now',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'), '35'
  union all
  select 'b3 product_notes has its seven columns',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'product_notes'), '7'
  union all
  select 'b4 kind defaults to sampling and the CHECK permits only that',
         (select (case when pg_get_constraintdef(oid) like '%sampling%' then 'yes' else 'no' end)::text
            from pg_constraint where conrelid = 'vessl.product_notes'::regclass
             and conname = 'product_notes_kind_check'), 'yes'
  union all
  select 'b5 row level security is on',
         (select relrowsecurity::text from pg_class where oid = 'vessl.product_notes'::regclass), 'true'
  union all
  select 'b6 select insert delete granted, table update not',
         (select has_table_privilege('authenticated','vessl.product_notes','SELECT')::text || '/'
              || has_table_privilege('authenticated','vessl.product_notes','INSERT')::text || '/'
              || has_table_privilege('authenticated','vessl.product_notes','DELETE')::text || '/'
              || has_table_privilege('authenticated','vessl.product_notes','UPDATE')::text),
         'true/true/true/false'
  union all
  select 'b7 column update on note and edited_at only',
         (select has_column_privilege('authenticated','vessl.product_notes','note','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.product_notes','edited_at','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.product_notes','author','UPDATE')::text || '/'
              || has_column_privilege('authenticated','vessl.product_notes','kind','UPDATE')::text),
         'true/true/false/false'
  union all
  select 'b8 three policies, in the shapes program_notes uses',
         (select string_agg(permissive || '/' || cmd, ' ' order by policyname) from pg_policies
           where schemaname = 'vessl' and tablename = 'product_notes'),
         'RESTRICTIVE/DELETE RESTRICTIVE/UPDATE PERMISSIVE/ALL'
  union all
  -- THE MIRROR IS PROVED BY COMPARISON, not by reading both and trusting the eye.
  select 'b9 the author rule is identical to the program_notes one',
         (select (case when (select qual from pg_policies where schemaname = 'vessl'
                              and tablename = 'product_notes'
                              and policyname = 'product_notes_author_only_update')
                          = (select author_expr from _pre66) then 'same' else 'differs' end)::text), 'same'
  union all
  select 'b10 the product_id index exists',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'product_notes'
             and indexname = 'product_notes_product_idx'), '1'
  union all
  select 'b11 the new table is empty',
         (select count(*)::text from vessl.product_notes), '0'
  union all
  -- THE REVOKE IS WHAT THIS PROVES. anon is not in the vessl default today, so
  -- this passing is the table staying shut rather than being shut by hand -- and
  -- it fails loudly if the schema default ever widens.
  select 'b12 anon holds nothing on the table',
         (select has_table_privilege('anon','vessl.product_notes','SELECT')::text || '/'
              || has_table_privilege('anon','vessl.product_notes','INSERT')::text || '/'
              || has_table_privilege('anon','vessl.product_notes','UPDATE')::text || '/'
              || has_table_privilege('anon','vessl.product_notes','DELETE')::text),
         'false/false/false/false'
  union all
  select 'c1 products, programs and program notes all unchanged',
         (select ((select count(*) from vessl.products)      - (select products_before from _pre66))::text || '/'
              || ((select count(*) from vessl.programs)      - (select programs_before from _pre66))::text || '/'
              || ((select count(*) from vessl.program_notes) - (select program_notes_before from _pre66))::text),
         '0/0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
