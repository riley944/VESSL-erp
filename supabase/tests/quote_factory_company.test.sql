-- Re-run the migration inside a transaction to exercise its legacy backfill.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
alter table vessl.quotes drop column if exists factory_company_id;

insert into vessl.companies (id, name, type) values
  ('f1000000-0000-4000-8000-000000000001', 'Factory Link Test Unique', 'factory'),
  ('f1000000-0000-4000-8000-000000000002', 'Factory Link Test Duplicate', 'factory'),
  ('f1000000-0000-4000-8000-000000000003', 'factory link test duplicate', 'factory'),
  ('f1000000-0000-4000-8000-000000000004', 'Factory Link Test Client', 'client');

insert into vessl.quotes (id, factory, factory_contact) values
  ('f2000000-0000-4000-8000-000000000001', '  FACTORY LINK TEST UNIQUE  ', 'Original contact'),
  ('f2000000-0000-4000-8000-000000000002', 'Factory Link Test Duplicate', null),
  ('f2000000-0000-4000-8000-000000000003', 'Factory Link Test Client', null),
  ('f2000000-0000-4000-8000-000000000004', 'Factory Link Test Missing', null),
  ('f2000000-0000-4000-8000-000000000005', '  ', null);

\ir ../migrations/20261117000000_quote_factory_company.sql

select plan(8);
select is((select factory_company_id from vessl.quotes where id = 'f2000000-0000-4000-8000-000000000001'), 'f1000000-0000-4000-8000-000000000001'::uuid, 'unique factory name is linked ignoring case and whitespace');
select is((select count(*) from vessl.quotes where id in ('f2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000005') and factory_company_id is null), 4::bigint, 'ambiguous, non-factory, unmatched and blank names remain unlinked');
select is((select factory from vessl.quotes where id = 'f2000000-0000-4000-8000-000000000001'), '  FACTORY LINK TEST UNIQUE  ', 'factory name snapshot is unchanged');
select is((select factory_contact from vessl.quotes where id = 'f2000000-0000-4000-8000-000000000001'), 'Original contact', 'contact snapshot is unchanged');
select throws_ok($$update vessl.quotes set factory_company_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' where id = 'f2000000-0000-4000-8000-000000000001'$$, '23503', null, 'unknown company IDs are rejected');
select lives_ok($$insert into vessl.quotes (id, factory) values ('f2000000-0000-4000-8000-000000000006', 'Unlinked')$$, 'new quotes may remain unlinked');
delete from vessl.companies where id = 'f1000000-0000-4000-8000-000000000001';
select is((select factory_company_id from vessl.quotes where id = 'f2000000-0000-4000-8000-000000000001'), null::uuid, 'deleting a factory clears the link');
select is((select factory_contact from vessl.quotes where id = 'f2000000-0000-4000-8000-000000000001'), 'Original contact', 'deleting a factory preserves quote details');
select * from finish();
rollback;
