-- 21 AFTER COMMIT -- run in a FRESH TAB, after script 21 has been committed.
--
-- Step 4 is EXPECTED TO FAIL, and its four lines must be run TOGETHER as one
-- block. Everything else succeeds.

-- 1. The function exists with the right shape. Expect one row reading
--    true, s, true -- security definer, stable, search_path pinned.
select p.prosecdef      as should_be_true,
       p.provolatile    as should_be_s,
       (p.proconfig is not null) as search_path_pinned,
       p.proconfig      as the_pinned_setting
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows';

-- 2. Who may execute it. Expect true, false, false. The second one is the one
--    that matters -- anon inherits PUBLIC and the anon key is in the browser
--    bundle, so a true there means this list is readable by anyone.
select has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_should_be_true,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_should_be_false,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_should_be_false
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'vessl' and p.proname = 'rfq_digest_rows';

-- 3. The scoping held. Expect schema usage true, and false for all three tables
--    -- the key can call one function and read no table.
select has_schema_privilege('service_role', 'vessl', 'USAGE')                  as usage_should_be_true,
       has_table_privilege('service_role', 'vessl.shipment_quotes', 'SELECT')  as sq_should_be_false,
       has_table_privilege('service_role', 'vessl.forwarder_bids', 'SELECT')   as fb_should_be_false,
       has_table_privilege('service_role', 'vessl.companies', 'SELECT')        as co_should_be_false;

-- 4. THE REFUSAL IS REAL, not just an absent grant in a catalogue. Run all four
--    lines together. The select MUST FAIL with permission denied for
--    function rfq_digest_rows. If it returns rows instead, anon can read the RFQ
--    list and the revokes did not take.
begin;
set local role anon;
select * from vessl.rfq_digest_rows();
rollback;

-- 5. What the digest will actually send this week. Oldest first, bucketed.
--    Expect the unassigned row to be listed as unassigned rather than sitting in
--    a chase bucket with an empty forwarder.
select bucket, quote_number, coalesce(forwarder, '(no forwarder recorded)') as forwarder,
       sent_on, days_outstanding
  from vessl.rfq_digest_rows()
 order by days_outstanding desc;

-- 6. Bucket totals, as a sanity check on the thresholds.
select bucket, count(*) as rows
  from vessl.rfq_digest_rows()
 group by bucket
 order by bucket;
