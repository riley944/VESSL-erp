-- 35 AFTER COMMIT -- run in a FRESH TAB, after script 35 has been committed.
--
-- Nothing here is expected to fail. Script 34 needed a separate file because its
-- behaviour test had to raise an error; this one is a separate file only so the
-- outside-the-transaction read is a real second look rather than the same
-- transaction reporting on itself. Quotes below are code, never comments.

-- 1. The shape survived the commit. Expect 14 rows, the six bank_ columns among
--    them, and no ach_info.
select ordinal_position, column_name, data_type
  from information_schema.columns
 where table_schema = 'vessl' and table_name = 'kui_settings'
 order by ordinal_position;

-- 2. RLS untouched by script 35. Expect exactly three rows, INSERT SELECT UPDATE,
--    and no DELETE row.
select policyname, cmd
  from pg_policies
 where schemaname = 'vessl' and tablename = 'kui_settings'
 order by cmd;

-- 3. The grant still excludes delete. Expect false, true, true, true.
select has_table_privilege('authenticated', 'vessl.kui_settings', 'DELETE') as delete_should_be_false,
       has_table_privilege('authenticated', 'vessl.kui_settings', 'SELECT') as select_should_be_true,
       has_table_privilege('authenticated', 'vessl.kui_settings', 'INSERT') as insert_should_be_true,
       has_table_privilege('authenticated', 'vessl.kui_settings', 'UPDATE') as update_should_be_true;

-- 4. Still empty, ready for the real details after ship. Expect 0.
select count(*) as should_be_zero from vessl.kui_settings;
