-- Local development data. Fixed IDs make this safe to run again without
-- resetting existing products or consuming additional style numbers.
insert into vessl.companies (id, name, type)
values
  ('a1b20000-0000-4000-8000-000000000101', 'Acme Test Company', 'client'),
  ('b2c30000-0000-4000-8000-000000000102', 'Beacon Test Company', 'client'),
  ('c3d40000-0000-4000-8000-000000000103', 'Cedar Test Company', 'client')
on conflict (id) do nothing;

insert into vessl.products (id, name, client_company_id, active)
select seed.id, seed.name, seed.company_id, true
from (values
  ('10000000-0000-4000-8000-000000000101'::uuid, 'Acme Water Bottle', 'a1b20000-0000-4000-8000-000000000101'::uuid),
  ('10000000-0000-4000-8000-000000000102'::uuid, 'Acme Tote Bag', 'a1b20000-0000-4000-8000-000000000101'::uuid),
  ('10000000-0000-4000-8000-000000000103'::uuid, 'Acme Travel Mug', 'a1b20000-0000-4000-8000-000000000101'::uuid),
  ('20000000-0000-4000-8000-000000000101'::uuid, 'Beacon Water Bottle', 'b2c30000-0000-4000-8000-000000000102'::uuid),
  ('20000000-0000-4000-8000-000000000102'::uuid, 'Beacon Tote Bag', 'b2c30000-0000-4000-8000-000000000102'::uuid),
  ('20000000-0000-4000-8000-000000000103'::uuid, 'Beacon Travel Mug', 'b2c30000-0000-4000-8000-000000000102'::uuid),
  ('30000000-0000-4000-8000-000000000101'::uuid, 'Cedar Water Bottle', 'c3d40000-0000-4000-8000-000000000103'::uuid),
  ('30000000-0000-4000-8000-000000000102'::uuid, 'Cedar Tote Bag', 'c3d40000-0000-4000-8000-000000000103'::uuid),
  ('30000000-0000-4000-8000-000000000103'::uuid, 'Cedar Travel Mug', 'c3d40000-0000-4000-8000-000000000103'::uuid)
) as seed(id, name, company_id)
where not exists (select 1 from vessl.products p where p.id = seed.id);
