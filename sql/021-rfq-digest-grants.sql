-- 21 -- vessl.rfq_digest_rows(), and the only two grants service_role gets.
--
-- ── WHY A FUNCTION AND NOT TABLE GRANTS ──────────────────────────────────────
-- The weekly RFQ digest runs on a schedule, so there is no signed-in user and no
-- token to run the read as. That leaves the service-role key, and service_role
-- carries rolbypassrls -- verified true in pg_roles -- so ROW LEVEL SECURITY DOES
-- NOT APPLY TO IT AT ALL. Grants are the only thing that limits that key.
--
-- Granting SELECT on shipment_quotes, forwarder_bids and companies would mean a
-- leaked or misused key reads all three tables in full, every client name and
-- every rate included. Instead this creates ONE function returning ONLY the
-- digest list and grants EXECUTE on it. The key can do exactly one thing.
--
-- This is also as close as a cron route can get to the stance the existing
-- /api/rfq/send route takes, which refuses the service-role key outright and says
-- why in a box comment -- that a service key would make the staff gate the only
-- thing between a bug and every row in the table. A scheduled job cannot run as
-- the caller, so it narrows what the key can reach instead.
--
-- ── THE DEFAULT GRANTS ARE THE DANGEROUS PART ────────────────────────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC. Not to a named role -- to PUBLIC,
-- which includes anon, and the anon key is embedded in the browser bundle and is
-- therefore public knowledge. A function created the obvious way would hand this
-- list to anybody who found the endpoint.
--
-- The vessl schema ALSO carries an ALTER DEFAULT PRIVILEGES granting authenticated
-- EXECUTE on new functions, measured in pg_default_acl as authenticated=X/postgres.
--
-- So both are revoked before anything is granted. This is the same lesson script
-- 34 paid for on tables, in its function form. NOT GRANTING IS NOT THE SAME AS
-- NOT GRANTED, and b5 and b6 assert the end state rather than trusting the two
-- revokes below.
--
-- ── WHAT THE FUNCTION RETURNS ────────────────────────────────────────────────
-- Sent RFQs with no forwarder_bids row, outstanding two days or more, oldest
-- first, bucketed. NO BID RECORDED IS NOT THE SAME AS NO REPLY -- bids are entered
-- by hand when the replies are imported, so an empty table can mean the forwarder
-- never answered or that nobody has typed it in yet. The bucket names carry that
-- distinction rather than the email having to explain it twice.
--
--   unassigned  no forwarder company recorded, so nobody can be chased. It needs
--               a forwarder assigned, which is a different action from a nudge.
--   awaiting    2 to 7 days. Normal.
--   chase       8 to 21 days. Worth a nudge.
--   stale       22 days or more. Past nudging, needs a decision.
--
-- SECURITY DEFINER with a pinned search_path, both copied from vessl.is_staff().
-- Definer rights are the point -- the caller has no table privileges whatsoever
-- and must not need any.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- rfq_digest_rows does not exist. service_role holds NOTHING on this schema, not
-- even USAGE, and false for SELECT on shipment_quotes, forwarder_bids, companies
-- and staff_profiles. service_role and postgres both carry rolbypassrls; anon and
-- authenticated do not. 12 sent RFQs, 1 bid recorded, 11 outstanding.
-- Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST, before the function exists, so a0 and a1 describe what was
-- there rather than what this script just did.
create temp table _pre21 on commit drop as
  select (select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows')     as fn_before,
         has_schema_privilege('service_role', 'vessl', 'USAGE')             as schema_usage_before,
         has_table_privilege('service_role', 'vessl.shipment_quotes', 'SELECT')::text || '/' ||
         has_table_privilege('service_role', 'vessl.forwarder_bids', 'SELECT')::text || '/' ||
         has_table_privilege('service_role', 'vessl.companies', 'SELECT')::text
                                                                            as sr_tables_before,
         has_table_privilege('authenticated', 'vessl.shipment_quotes', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.forwarder_bids', 'SELECT')::text || '/' ||
         has_table_privilege('authenticated', 'vessl.companies', 'SELECT')::text
                                                                            as auth_tables_before;

create or replace function vessl.rfq_digest_rows()
returns table (
  quote_number     text,
  forwarder        text,
  sent_on          date,
  days_outstanding integer,
  bucket           text
)
language sql
stable
security definer
set search_path to 'vessl', 'public'
as $fn$
  select sq.quote_number,
         c.name as forwarder,
         sq.sent_at::date as sent_on,
         (current_date - sq.sent_at::date)::integer as days_outstanding,
         case
           when sq.forwarder_company_id is null then 'unassigned'
           when (current_date - sq.sent_at::date) >= 22 then 'stale'
           when (current_date - sq.sent_at::date) >= 8  then 'chase'
           else 'awaiting'
         end as bucket
    from vessl.shipment_quotes sq
    left join vessl.companies c on c.id = sq.forwarder_company_id
   where sq.status = 'sent'
     and sq.sent_at is not null
     and (current_date - sq.sent_at::date) >= 2
     and not exists (select 1 from vessl.forwarder_bids b
                      where b.shipment_quote_id = sq.id)
   order by sq.sent_at asc;
$fn$;

comment on function vessl.rfq_digest_rows() is
  'Rows for the weekly RFQ reminder digest. Sent RFQs with no forwarder_bids row, two days or older, oldest first. A missing bid means none has been RECORDED, which is not the same as no reply having arrived. Executable by service_role only; the scheduled route holds no table privileges.';

-- REVOKE BOTH DEFAULTS FIRST. CREATE FUNCTION grants EXECUTE to PUBLIC, and the
-- schema default grants it to authenticated. Neither should have it.
revoke all on function vessl.rfq_digest_rows() from public;
revoke all on function vessl.rfq_digest_rows() from authenticated;

-- The only two grants service_role receives on this schema, ever.
grant usage on schema vessl to service_role;
grant execute on function vessl.rfq_digest_rows() to service_role;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the function did not exist before this script' as chk,
         (select fn_before::text from _pre21) as got, '0' as want
  union all
  select 'a1 service_role held no schema usage and no table reads before',
         (select schema_usage_before::text || ' and ' || sr_tables_before from _pre21),
         'false and false/false/false'
  union all
  select 'b1 the function exists now',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), '1'
  union all
  select 'b2 security definer and stable, matching is_staff',
         (select p.prosecdef::text || '/' || p.provolatile::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), 'true/s'
  union all
  -- A definer function without a pinned search_path is the classic privilege
  -- escalation shape, so this asserts the setting is actually attached.
  select 'b3 search_path is pinned on the function',
         (select (p.proconfig is not null)::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), 'true'
  union all
  select 'b4 service_role may execute it',
         (select has_function_privilege('service_role', p.oid, 'EXECUTE')::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), 'true'
  union all
  -- THE ONE THAT MATTERS MOST. anon inherits PUBLIC, and the anon key is in the
  -- browser bundle. If this ever reads true, the RFQ list is public.
  select 'b5 anon may NOT execute it',
         (select has_function_privilege('anon', p.oid, 'EXECUTE')::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), 'false'
  union all
  select 'b6 authenticated may NOT execute it either',
         (select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows'), 'false'
  union all
  select 'c1 service_role now has schema usage',
         has_schema_privilege('service_role', 'vessl', 'USAGE')::text, 'true'
  union all
  -- THE POINT OF SCOPING, asserted rather than assumed. The key can call one
  -- function and read no table.
  select 'c2 service_role still reads none of the three tables',
         (select has_table_privilege('service_role', 'vessl.shipment_quotes', 'SELECT')::text || '/' ||
                 has_table_privilege('service_role', 'vessl.forwarder_bids', 'SELECT')::text || '/' ||
                 has_table_privilege('service_role', 'vessl.companies', 'SELECT')::text),
         'false/false/false'
  union all
  select 'c3 authenticated is unchanged by this script',
         (select has_table_privilege('authenticated', 'vessl.shipment_quotes', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.forwarder_bids', 'SELECT')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.companies', 'SELECT')::text || ' vs ' ||
                 (select auth_tables_before from _pre21)),
         (select auth_tables_before || ' vs ' || auth_tables_before from _pre21)
  union all
  -- THE FUNCTION AGREES WITH AN INDEPENDENT EXPRESSION. Stated as a difference so
  -- it does not go stale as RFQs are sent and bids are entered.
  select 'c4 the function returns exactly the rows the same rule selects inline',
         (select ((select count(*) from vessl.rfq_digest_rows())
                - (select count(*) from vessl.shipment_quotes sq
                    where sq.status = 'sent' and sq.sent_at is not null
                      and (current_date - sq.sent_at::date) >= 2
                      and not exists (select 1 from vessl.forwarder_bids b
                                       where b.shipment_quote_id = sq.id)))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
