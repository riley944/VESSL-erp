-- Keep the quote's factory name and contact details as historical snapshots.
-- The nullable link allows older quotes without an unambiguous match to remain.
alter table vessl.quotes
  add column factory_company_id uuid references vessl.companies(id) on delete set null;

create index quotes_factory_company_id_idx on vessl.quotes (factory_company_id);

-- Names were stored as text. Only link a name if exactly one factory matches
-- after trimming and ignoring case; leave unmatched and ambiguous names alone.
with unique_factories as (
  select lower(trim(name)) as name_key, min(id::text)::uuid as id
  from vessl.companies
  where type = 'factory' and nullif(trim(name), '') is not null
  group by lower(trim(name))
  having count(*) = 1
)
update vessl.quotes q
set factory_company_id = f.id
from unique_factories f
where nullif(trim(q.factory), '') is not null
  and lower(trim(q.factory)) = f.name_key;

comment on column vessl.quotes.factory_company_id is
  'Factory company linked to the quote; factory text and contact fields preserve the quote snapshot.';
