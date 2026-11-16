-- Existing products remain unnumbered until a separate backfill.
alter table vessl.companies
  add column last_style_iteration integer not null default 0,
  add constraint companies_last_style_iteration_nonnegative
    check (last_style_iteration >= 0);

alter table vessl.products
  add column style_number text,
  add constraint products_style_number_key unique (style_number);

comment on column vessl.companies.last_style_iteration is
  'Last style iteration assigned to this client; zero means none assigned.';
comment on column vessl.products.style_number is
  'Unique client style number; NULL for products not yet assigned one.';

create function vessl.assign_product_style_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  company_name text;
  iteration integer;
  candidate text;
begin
  -- Preserve imported numbers and allow legacy products without a client.
  if new.client_company_id is null or new.style_number is not null then
    return new;
  end if;

  loop
    -- The row lock serializes allocations for the same company, and this
    -- update rolls back if the product insert fails.
    update vessl.companies
    set last_style_iteration = last_style_iteration + 1
    where id = new.client_company_id
    returning name, last_style_iteration into company_name, iteration;

    if not found then
      raise exception 'Cannot assign a style number: client company % not found or not accessible', new.client_company_id;
    end if;

    candidate := upper(left(trim(company_name), 3)) || '-'
      || lpad(iteration::text, greatest(5, length(iteration::text)), '0') || '-'
      || upper(left(new.client_company_id::text, 4));

    -- Different companies can share a name prefix and UUID prefix.
    exit when not exists (select 1 from vessl.products where style_number = candidate);
  end loop;

  new.style_number := candidate;
  return new;
end;
$$;

create trigger trg_assign_product_style_number
before insert on vessl.products
for each row execute function vessl.assign_product_style_number();
