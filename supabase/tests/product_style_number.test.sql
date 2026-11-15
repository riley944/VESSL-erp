begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(10);

insert into vessl.companies (id, name) values
  ('a1b20000-0000-4000-8000-000000000001', 'Acme pgTAP fixture'),
  ('c3d40000-0000-4000-8000-000000000002', 'Bravo pgTAP fixture');

insert into vessl.products (id, name, client_company_id) values
  ('10000000-0000-4000-8000-000000000001', 'First product', 'a1b20000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Second product', 'a1b20000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', 'Other company product', 'c3d40000-0000-4000-8000-000000000002');

select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000001'), 'ACM-00001-A1B2', 'first product receives the expected style number');
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000002'), 'ACM-00002-A1B2', 'second product receives the next style number');
select is((select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000001'), 2, 'company counter advances per product');
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000003'), 'BRA-00001-C3D4', 'another company has its own sequence');

update vessl.products set name = 'Renamed product' where id = '10000000-0000-4000-8000-000000000001';
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000001'), 'ACM-00001-A1B2', 'updating a product preserves its style number');
select is((select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000001'), 2, 'updating a product does not advance the counter');

insert into vessl.companies (id, name) values ('a1b20000-0000-4000-8000-000000000003', 'Acme collision fixture');
insert into vessl.products (id, client_company_id) values ('10000000-0000-4000-8000-000000000004', 'a1b20000-0000-4000-8000-000000000003');
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000004'), 'ACM-00003-A1B2', 'colliding style numbers are skipped');
select is((select last_style_iteration from vessl.companies where id = 'a1b20000-0000-4000-8000-000000000003'), 3, 'counter records the assigned iteration');

update vessl.companies set last_style_iteration = 99999 where id = 'c3d40000-0000-4000-8000-000000000002';
insert into vessl.products (id, client_company_id) values ('10000000-0000-4000-8000-000000000005', 'c3d40000-0000-4000-8000-000000000002');
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000005'), 'BRA-100000-C3D4', 'iterations beyond five digits are not truncated');

insert into vessl.products (id, name) values ('10000000-0000-4000-8000-000000000006', 'Unlinked product');
select is((select style_number from vessl.products where id = '10000000-0000-4000-8000-000000000006'), null::text, 'products without a company remain unnumbered');

select * from finish();
rollback;
