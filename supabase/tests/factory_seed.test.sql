begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(3);

select is((select count(*) from vessl.companies where type = 'factory' and id in (
  'd4e50000-0000-4000-8000-000000000101', 'd4e50000-0000-4000-8000-000000000102'
)), 2::bigint, 'both sample factories are seeded');

select is((select count(*) from vessl.contacts where is_primary and company_id in (
  'd4e50000-0000-4000-8000-000000000101', 'd4e50000-0000-4000-8000-000000000102'
)), 2::bigint, 'each sample factory has a primary contact');

select is((select count(distinct q.factory) from vessl.quotes q join vessl.companies c on c.name = q.factory and c.type = 'factory'
  where q.id between '40000000-0000-4000-8000-000000000101'::uuid and '40000000-0000-4000-8000-000000000109'::uuid
    and c.id in ('d4e50000-0000-4000-8000-000000000101', 'd4e50000-0000-4000-8000-000000000102')),
  2::bigint, 'sample quote factories match the seeded companies');

select * from finish();
rollback;
