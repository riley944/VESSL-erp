begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
insert into vessl.companies (id, name, type) values
  ('f3000000-0000-4000-8000-000000000001', 'Backfill Unique Factory', 'factory'),
  ('f3000000-0000-4000-8000-000000000002', 'Backfill Twin', 'factory'),
  ('f3000000-0000-4000-8000-000000000003', 'backfill twin', 'factory');
insert into vessl.quotes (id, factory, factory_company_id) values
  ('f4000000-0000-4000-8000-000000000001', ' BACKFILL UNIQUE FACTORY ', null),
  ('f4000000-0000-4000-8000-000000000002', 'Backfill Twin', null),
  ('f4000000-0000-4000-8000-000000000003', 'Backfill Unique Factory', 'f3000000-0000-4000-8000-000000000002');
\ir ../migrations/20261117000001_backfill_missing_quote_factory_links.sql
select plan(3);
select is((select factory_company_id from vessl.quotes where id = 'f4000000-0000-4000-8000-000000000001'), 'f3000000-0000-4000-8000-000000000001'::uuid, 'backfills unique missing links');
select is((select factory_company_id from vessl.quotes where id = 'f4000000-0000-4000-8000-000000000002'), null::uuid, 'does not guess ambiguous names');
select is((select factory_company_id from vessl.quotes where id = 'f4000000-0000-4000-8000-000000000003'), 'f3000000-0000-4000-8000-000000000002'::uuid, 'preserves existing links even when names differ');
select * from finish();
rollback;
