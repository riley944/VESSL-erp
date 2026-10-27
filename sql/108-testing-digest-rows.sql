-- 108 -- vessl.testing_digest_rows(), the rows for the weekly testing email to Jenn.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 108r.
--
-- WHAT IT DOES. Creates one function and grants EXECUTE on it to service_role,
-- and to nobody else. No table is touched, no row is written, and no grant on any
-- table changes.
--
-- WHY A FUNCTION, the same reasoning as script 21. The email is sent by a
-- scheduled route with no signed-in user, so it reads with the service-role key.
-- service_role bypasses row security entirely, so grants are the only limit on
-- that key -- and today it holds USAGE on the schema and EXECUTE on
-- rfq_digest_rows() and nothing else. Granting it SELECT on products, test_reports
-- and companies would let a leaked key read all three in full. Instead it gets
-- one more function returning one list.
--
-- ── WHAT THE FUNCTION RETURNS ────────────────────────────────────────────────
-- One row per product per sheet, every column the workbook prints plus the
-- product id. Products in scope are those not explicitly inactive (active is true
-- or NULL -- NULL means the catalogue status was never set, and those count), with
-- the ZZ test records left out (sku or name starting zz, any case).
--
--   sheet 1  Nothing set      stage NULL, compliance NULL or blank
--   sheet 2  Compliance only  stage NULL, compliance filled in (tbd counts as filled)
--   sheet 3  Stage only       stage set, compliance NULL or blank
--   sheet 4  Compliance TBD   compliance is tbd, whatever the stage
--
-- Sheets 1 to 3 never share a product. Sheet 4 can repeat a product from sheet 2
-- (no stage, compliance tbd) -- none today, and by design if it happens.
--
-- THE RULES MATCH THE TESTING PAGE, so the counts in the email agree with what
-- its filters show. Stage unset is NULL only (products_product_stage_check allows
-- NULL, production or sample, nothing blank). Compliance unset is NULL or blank,
-- the bucket complianceKey calls unset. TBD is its own value there, so it is set
-- here. Report on file means a test_reports row on the product itself -- a report
-- linked only to a material does not count, as on the page. The latest test date
-- is the newest test_date among those reports, else the hand-entered
-- manual_test_date, the same fallback as the page Testing date column.
--
-- Ordered by sheet, then created_at newest first, then SKU, then id so the order
-- is total. The route sorts again on the same keys rather than rely on it.
--
-- SECURITY DEFINER with a pinned search_path, as rfq_digest_rows. Definer rights
-- are the point -- the caller holds no table privileges and must not need any.
-- Every name in the body is schema-qualified anyway.
--
-- ── THE DEFAULT GRANTS ───────────────────────────────────────────────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC, which includes anon, and the anon key
-- is in the browser bundle. The vessl schema also carries a default privilege
-- giving authenticated EXECUTE on new functions (f authenticated=X/postgres in
-- pg_default_acl, measured). Both are revoked before the one grant, and b5 and b6
-- assert the end state rather than trusting the revokes.
--
-- ── MEASURED BEFORE WRITING, against the live database, 5 Oct 2026 ───────────
-- testing_digest_rows does not exist. service_role has USAGE on vessl (script 21)
-- and false for SELECT on products, test_reports and companies; authenticated
-- has true for all three. The same rule run inline gives sheet 1 48, sheet 2 0,
-- sheet 3 3, sheet 4 130, over 209 products in scope.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a, b or c row is a failed check. Zero rows means the query did not run.

begin;

-- PRE-STATE FIRST, before the function exists.
create temp table _pre108 on commit drop as
  select (select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows')    as fn_before,
         has_schema_privilege('service_role', 'vessl', 'USAGE')             as sr_usage_before,
         has_table_privilege('service_role', 'vessl.products', 'SELECT')::text || '/' ||
         has_table_privilege('service_role', 'vessl.test_reports', 'SELECT')::text || '/' ||
         has_table_privilege('service_role', 'vessl.companies', 'SELECT')::text
                                                                            as sr_tables_before,
         has_table_privilege('authenticated', 'vessl.products', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.test_reports', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.companies', 'SELECT')::text
                                                                            as auth_tables_before;

create or replace function vessl.testing_digest_rows()
returns table (
  sheet             integer,
  product_id        uuid,
  sku               text,
  name              text,
  client            text,
  created_at        timestamptz,
  product_stage     text,
  compliance_status text,
  report_on_file    boolean,
  latest_test_date  date
)
language sql
stable
security definer
set search_path to 'vessl', 'pg_temp'
as $fn$
  with base as (
    select p.id, p.sku, p.name, c.name as client, p.created_at,
           p.product_stage, p.compliance_status,
           exists (select 1 from vessl.test_reports r where r.product_id = p.id) as report_on_file,
           coalesce((select max(r.test_date) from vessl.test_reports r where r.product_id = p.id),
                    p.manual_test_date) as latest_test_date,
           (p.product_stage is null) as stage_unset,
           (nullif(btrim(p.compliance_status), '') is null) as comp_unset,
           (lower(btrim(p.compliance_status)) = 'tbd') as comp_tbd
      from vessl.products p
      left join vessl.companies c on c.id = p.client_company_id
     where p.active is not false
       and coalesce(p.sku, '') not ilike 'zz%'
       and coalesce(p.name, '') not ilike 'zz%'
  ), sheets as (
    select 1 as sheet, b.* from base b where b.stage_unset and b.comp_unset
    union all
    select 2, b.* from base b where b.stage_unset and not b.comp_unset
    union all
    select 3, b.* from base b where not b.stage_unset and b.comp_unset
    union all
    select 4, b.* from base b where b.comp_tbd
  )
  select s.sheet, s.id, s.sku, s.name, s.client, s.created_at,
         s.product_stage, s.compliance_status, s.report_on_file, s.latest_test_date
    from sheets s
   order by s.sheet, s.created_at desc nulls last, s.sku asc nulls last, s.id;
$fn$;

comment on function vessl.testing_digest_rows() is
  'Rows for the weekly testing email. Sheet 1 nothing set, 2 compliance only, 3 stage only, 4 compliance tbd. Products not explicitly inactive, ZZ test records excluded. Rules match the Testing page filters. Executable by service_role only; the scheduled route holds no table privileges.';

revoke all on function vessl.testing_digest_rows() from public;
revoke all on function vessl.testing_digest_rows() from anon;
revoke all on function vessl.testing_digest_rows() from authenticated;
grant execute on function vessl.testing_digest_rows() to service_role;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the function did not exist before this script' as chk,
         (select fn_before::text from _pre108) as got, '0' as want
  union all
  select 'a1 service_role had schema usage and no table reads before',
         (select sr_usage_before::text || ' and ' || sr_tables_before from _pre108),
         'true and false/false/false'
  union all
  select 'b1 the function exists now',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows'), '1'
  union all
  select 'b2 security definer and stable',
         (select p.prosecdef::text || '/' || p.provolatile::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows'), 'true/s'
  union all
  select 'b3 search_path is pinned on the function',
         (select (p.proconfig is not null)::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'testing_digest_rows'), 'true'
  union all
  select 'b4 service_role may execute it',
         has_function_privilege('service_role', 'vessl.testing_digest_rows()', 'EXECUTE')::text, 'true'
  union all
  -- anon inherits PUBLIC, and the anon key is in the browser bundle. If this ever
  -- reads true, the list is public.
  select 'b5 anon may NOT execute it',
         has_function_privilege('anon', 'vessl.testing_digest_rows()', 'EXECUTE')::text, 'false'
  union all
  select 'b6 authenticated may NOT execute it either',
         has_function_privilege('authenticated', 'vessl.testing_digest_rows()', 'EXECUTE')::text, 'false'
  union all
  select 'c1 service_role still reads none of the three tables',
         (has_table_privilege('service_role', 'vessl.products', 'SELECT')::text || '/' ||
          has_table_privilege('service_role', 'vessl.test_reports', 'SELECT')::text || '/' ||
          has_table_privilege('service_role', 'vessl.companies', 'SELECT')::text),
         'false/false/false'
  union all
  select 'c2 authenticated table reads are unchanged by this script',
         (has_table_privilege('authenticated', 'vessl.products', 'SELECT')::text || '/' ||
          has_table_privilege('authenticated', 'vessl.test_reports', 'SELECT')::text || '/' ||
          has_table_privilege('authenticated', 'vessl.companies', 'SELECT')::text),
         (select auth_tables_before from _pre108)
  union all
  select 'c3 rfq_digest_rows is untouched, service_role only',
         (has_function_privilege('service_role', 'vessl.rfq_digest_rows()', 'EXECUTE')::text || '/' ||
          has_function_privilege('anon', 'vessl.rfq_digest_rows()', 'EXECUTE')::text || '/' ||
          has_function_privilege('authenticated', 'vessl.rfq_digest_rows()', 'EXECUTE')::text),
         'true/false/false'
  union all
  -- THE FUNCTION AGREES WITH AN INDEPENDENT EXPRESSION of the same rule, sheet by
  -- sheet, stated as differences so it does not go stale as products change.
  select 'c4 each sheet count equals the rule run inline, as differences',
         (with inl as (
            select p.id,
                   case when p.product_stage is null and coalesce(btrim(p.compliance_status), '') = '' then 1
                        when p.product_stage is null then 2
                        when coalesce(btrim(p.compliance_status), '') = '' then 3
                   end as s123,
                   (lower(btrim(p.compliance_status)) = 'tbd') as s4
              from vessl.products p
             where (p.active is null or p.active)
               and left(lower(coalesce(p.sku, '')), 2) <> 'zz'
               and left(lower(coalesce(p.name, '')), 2) <> 'zz')
          select string_agg(((select count(*) from vessl.testing_digest_rows() f where f.sheet = k)
                           - case when k = 4 then (select count(*) from inl where s4)
                                  else (select count(*) from inl where s123 = k) end)::text, '/' order by k)
            from generate_series(1, 4) k),
         '0/0/0/0'
  union all
  select 'c5 no product appears on more than one of sheets 1 to 3',
         (select count(*)::text from (
            select f.product_id from vessl.testing_digest_rows() f
             where f.sheet between 1 and 3 group by f.product_id having count(*) > 1) d), '0'
  union all
  select 'c6 no inactive product and no ZZ record in the output',
         (select count(*)::text from vessl.testing_digest_rows() f
            join vessl.products p on p.id = f.product_id
           where p.active = false
              or left(lower(coalesce(p.sku, '')), 2) = 'zz'
              or left(lower(coalesce(p.name, '')), 2) = 'zz'), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
