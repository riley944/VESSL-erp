-- Only fill missing links with a unique name match. Existing links and quote
-- snapshots may legitimately differ after a factory rename and are preserved.
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
where q.factory_company_id is null
  and nullif(trim(q.factory), '') is not null
  and lower(trim(q.factory)) = f.name_key;
