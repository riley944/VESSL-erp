-- 36 AFTER COMMIT -- run in a FRESH TAB, after script 36 has been committed.
--
-- Step 5 is EXPECTED TO FAIL. Read the note above it before running, and run the
-- statements one at a time rather than as one batch.
--
-- NOTHING HERE PRINTS A BANK VALUE. Step 2 reports whether each field is filled
-- as a true or false, never its contents, so this can be run and pasted around
-- without leaking an account number.

-- 1. The shape survived the commit. Expect 12 rows and no surprises.
select ordinal_position, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'vessl' and table_name = 'payment_accounts'
 order by ordinal_position;

-- 2. One account, default and active, with the six fields carried across.
--    Expect one row, label Primary, both booleans true, and a filled column
--    reading true for each field that had content in kui_settings.
select label,
       is_default,
       active,
       (coalesce(bank_name,'')           <> '') as bank_name_filled,
       (coalesce(bank_beneficiary,'')    <> '') as beneficiary_filled,
       (coalesce(bank_account_number,'') <> '') as account_number_filled,
       (coalesce(bank_routing_aba,'')    <> '') as routing_filled,
       (coalesce(bank_swift,'')          <> '') as swift_filled,
       (coalesce(bank_address,'')        <> '') as bank_address_filled
  from vessl.payment_accounts;

-- 3. The quotes side. Expect the column to exist, the foreign key to be present,
--    and every quote to hold NULL so every quote uses the default.
select (select count(*) from information_schema.columns
         where table_schema = 'vessl' and table_name = 'quotes'
           and column_name = 'payment_account_id')                as column_should_be_1,
       (select count(*) from pg_constraint con
          join pg_class c  on c.oid  = con.conrelid
          join pg_class rc on rc.oid = con.confrelid
         where con.contype = 'f' and c.relname = 'quotes'
           and rc.relname = 'payment_accounts')                   as fk_should_be_1,
       (select count(*) from vessl.quotes
         where payment_account_id is not null)                    as assigned_should_be_0,
       (select count(*) from vessl.quotes)                        as quotes_total;

-- 4. Policies and privileges. Expect three rows INSERT SELECT UPDATE with no
--    DELETE, and false true true true on the second query.
select policyname, cmd
  from pg_policies
 where schemaname = 'vessl' and tablename = 'payment_accounts'
 order by cmd;

select has_table_privilege('authenticated', 'vessl.payment_accounts', 'DELETE') as delete_should_be_false,
       has_table_privilege('authenticated', 'vessl.payment_accounts', 'SELECT') as select_should_be_true,
       has_table_privilege('authenticated', 'vessl.payment_accounts', 'INSERT') as insert_should_be_true,
       has_table_privilege('authenticated', 'vessl.payment_accounts', 'UPDATE') as update_should_be_true;

-- 5. THE PARTIAL UNIQUE INDEX ACTUALLY BITES. This is the behaviour test the
--    rehearsal could not run without poisoning its own transaction, which is why
--    it lives out here. It MUST FAIL, with a unique violation naming
--    payment_accounts_single_default.
--
--    If it SUCCEEDS, the index is not doing its job and a second default now
--    exists. Two defaults make the NULL resolution ambiguous, so remove the
--    stray row before going further -- as the table owner in this editor a
--    delete is possible even though the authenticated role has no DELETE.
insert into vessl.payment_accounts (label, is_default) values ('ZZTEST second default', true);

-- 6. And the harmless half of the same rule -- a second NON default account is
--    allowed, because the index only constrains is_default true. Expect this to
--    succeed, then remove it.
--
--    insert into vessl.payment_accounts (label) values ('ZZTEST second account');
--    delete from vessl.payment_accounts where label = 'ZZTEST second account';
