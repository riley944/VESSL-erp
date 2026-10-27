-- 34 AFTER COMMIT -- run in a FRESH TAB, after script 34 has been committed.
-- Separate file rather than a comment block at the foot of the script, because
-- these lines carry quotes and a quote inside a -- comment is what broke script
-- 23 in this client. Here they are code, which is safe.
--
-- Step 2 is EXPECTED TO FAIL. Read the note above it before running.

-- 1. The table survived the transaction, and is still empty as intended.
select count(*) as should_be_zero from vessl.kui_settings;

-- 2. The single-row guard actually bites. This is the behaviour test the
--    rehearsal could not run without poisoning its own transaction, which is why
--    it lives out here. It MUST FAIL, with a check constraint violation naming
--    kui_settings_single_row. A success means the guard is not working and the
--    row it just wrote has to be removed by hand.
insert into vessl.kui_settings (id, company_name) values (2, null);

-- 3. Policies and privileges, read back from the catalogue. Expect three rows
--    reading INSERT, SELECT, UPDATE, and no DELETE row.
select policyname, cmd
  from pg_policies
 where schemaname = 'vessl' and tablename = 'kui_settings'
 order by cmd;

-- 4. Delete refused at the privilege layer too. Expect false.
select has_table_privilege('authenticated', 'vessl.kui_settings', 'DELETE') as delete_should_be_false,
       has_table_privilege('authenticated', 'vessl.kui_settings', 'SELECT') as select_should_be_true,
       has_table_privilege('authenticated', 'vessl.kui_settings', 'UPDATE') as update_should_be_true;
