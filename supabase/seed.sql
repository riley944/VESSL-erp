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

-- One sample factory quote per seed product. Read the product and client from
-- the existing records so the links and names stay consistent. The NOT EXISTS
-- check also avoids consuming another quote code when the seed is rerun.
insert into vessl.quotes (id, product_id, client_company_id, product, client, factory, tiers)
select seed.id, p.id, p.client_company_id, p.name, c.name, seed.factory,
  jsonb_build_array(
    jsonb_build_object('qty', 1000, 'landed', seed.cost, 'ship', 'ocean', 'client', seed.price),
    jsonb_build_object('qty', 5000, 'landed', seed.cost_bulk, 'ship', 'ocean', 'client', seed.price_bulk)
  )
from (values
  ('40000000-0000-4000-8000-000000000101'::uuid, '10000000-0000-4000-8000-000000000101'::uuid, 'Harbor Test Factory', 3.25, 5.25, 2.95, 4.85),
  ('40000000-0000-4000-8000-000000000102'::uuid, '10000000-0000-4000-8000-000000000102'::uuid, 'Summit Test Factory', 2.10, 3.50, 1.90, 3.20),
  ('40000000-0000-4000-8000-000000000103'::uuid, '10000000-0000-4000-8000-000000000103'::uuid, 'Harbor Test Factory', 4.20, 6.75, 3.90, 6.25),
  ('40000000-0000-4000-8000-000000000104'::uuid, '20000000-0000-4000-8000-000000000101'::uuid, 'Harbor Test Factory', 3.40, 5.50, 3.10, 5.00),
  ('40000000-0000-4000-8000-000000000105'::uuid, '20000000-0000-4000-8000-000000000102'::uuid, 'Summit Test Factory', 2.25, 3.75, 2.00, 3.35),
  ('40000000-0000-4000-8000-000000000106'::uuid, '20000000-0000-4000-8000-000000000103'::uuid, 'Harbor Test Factory', 4.35, 7.00, 4.00, 6.50),
  ('40000000-0000-4000-8000-000000000107'::uuid, '30000000-0000-4000-8000-000000000101'::uuid, 'Harbor Test Factory', 3.15, 5.10, 2.85, 4.65),
  ('40000000-0000-4000-8000-000000000108'::uuid, '30000000-0000-4000-8000-000000000102'::uuid, 'Summit Test Factory', 2.00, 3.35, 1.80, 3.00),
  ('40000000-0000-4000-8000-000000000109'::uuid, '30000000-0000-4000-8000-000000000103'::uuid, 'Harbor Test Factory', 4.10, 6.60, 3.80, 6.10)
) as seed(id, product_id, factory, cost, price, cost_bulk, price_bulk)
join vessl.products p on p.id = seed.product_id
join vessl.companies c on c.id = p.client_company_id
where not exists (select 1 from vessl.quotes q where q.id = seed.id);
