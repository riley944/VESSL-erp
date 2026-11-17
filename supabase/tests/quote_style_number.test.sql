begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

insert into vessl.companies (id, name)
values
  ('a1b20000-0000-4000-8000-000000000001', 'Acme Test Company'),
  ('c3d40000-0000-4000-8000-000000000002', 'Bravo Test Company');

insert into vessl.quotes (id, client_company_id)
values ('10000000-0000-4000-8000-000000000001', 'a1b20000-0000-4000-8000-000000000001');

select is(
  (select style_number from vessl.quotes where id = '10000000-0000-4000-8000-000000000001'),
  'ACM-00001-A1B2',
  'the first quote gets the expected style number'
);
select is(
  (select active from vessl.quotes where id = '10000000-0000-4000-8000-000000000001'),
  true,
  'a new quote is active'
);
select is(
  (select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000001'),
  1,
  'the first quote advances its company counter'
);

insert into vessl.quotes (id, client_company_id)
values ('10000000-0000-4000-8000-000000000002', 'a1b20000-0000-4000-8000-000000000001');

select is(
  (select style_number from vessl.quotes where id = '10000000-0000-4000-8000-000000000002'),
  'ACM-00002-A1B2',
  'the next quote has the next style number'
);
select is(
  (select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000001'),
  2,
  'the next quote advances the company counter again'
);

insert into vessl.quotes (id, client_company_id)
values ('10000000-0000-4000-8000-000000000003', 'c3d40000-0000-4000-8000-000000000002');

select is(
  (select style_number from vessl.quotes where id = '10000000-0000-4000-8000-000000000003'),
  'BRA-00001-C3D4',
  'another company has its own numbering sequence'
);
select is(
  (select last_style_iteration from vessl.companies where id = 'c3d40000-0000-4000-8000-000000000002'),
  1,
  'another company has its own counter'
);

update vessl.quotes set active = false
where id = '10000000-0000-4000-8000-000000000001';

select results_eq(
  $$ select id from vessl.quotes
     where client_company_id = 'a1b20000-0000-4000-8000-000000000001' and active = true
     order by id $$,
  $$ values ('10000000-0000-4000-8000-000000000002'::uuid) $$,
  'a company active-quotes query excludes inactive quotes and other companies'
);
select is(
  (select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000001'),
  2,
  'deactivating a quote does not change the company counter'
);

insert into vessl.companies (id, name)
values ('a1b20000-0000-4000-8000-000000000003', 'Acme Collision Test');
insert into vessl.quotes (id, client_company_id)
values ('10000000-0000-4000-8000-000000000004', 'a1b20000-0000-4000-8000-000000000003');

select is(
  (select style_number from vessl.quotes where id = '10000000-0000-4000-8000-000000000004'),
  'ACM-00003-A1B2',
  'a company skips style numbers already assigned to another company'
);
select is(
  (select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000003'),
  3,
  'the counter records the iteration actually assigned after a collision'
);

update vessl.companies set last_style_iteration = 99999
where id = 'c3d40000-0000-4000-8000-000000000002';
insert into vessl.quotes (id, client_company_id)
values ('10000000-0000-4000-8000-000000000005', 'c3d40000-0000-4000-8000-000000000002');
select is(
  (select style_number from vessl.quotes where id = '10000000-0000-4000-8000-000000000005'),
  'BRA-100000-C3D4',
  'iterations beyond five digits are not truncated'
);

select * from finish();
rollback;
