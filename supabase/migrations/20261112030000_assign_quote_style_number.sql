-- Allocate the counter and style number in the same transaction as the quote.
-- Legacy quote creation can still insert an unlinked quote; it must supply a
-- client_company_id at insert time to receive a style number.
create function vessl.assign_quote_style_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  company_name text;
  iteration integer;
  candidate text;
begin
  if new.client_company_id is null or new.style_number is not null then
    return new;
  end if;

  loop
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

    -- UUID prefixes can collide. Skip numbers already assigned to another quote;
    -- the unique constraint remains the final guard against concurrent collisions.
    exit when not exists (select 1 from vessl.quotes where style_number = candidate);
  end loop;

  new.style_number := candidate;
  return new;
end;
$$;

create trigger trg_assign_quote_style_number
before insert on vessl.quotes
for each row execute function vessl.assign_quote_style_number();
