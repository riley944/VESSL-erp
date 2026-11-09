-- 150 -- Prepare company style counters and quote style numbers.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written
-- (ROLLBACK), then replace the final ROLLBACK with COMMIT to apply.
--
-- Existing companies start at zero; existing quotes have no style number.
-- NULL style numbers may coexist, but assigned style numbers must be unique.
-- This only adds the columns and constraints: it does not generate numbers,
-- backfill quotes, or advance counters. Allocation must later increment the
-- counter and save the quote atomically.

begin;

alter table vessl.companies
  add column last_style_iteration integer not null default 0,
  add constraint companies_last_style_iteration_nonnegative
    check (last_style_iteration >= 0);

alter table vessl.quotes
  add column style_number text,
  add constraint quotes_style_number_key unique (style_number);

comment on column vessl.companies.last_style_iteration is
  'Last style iteration assigned to this client; zero means none assigned.';
comment on column vessl.quotes.style_number is
  'Unique client style number; NULL for quotes not yet assigned one.';

-- Verify the column types, defaults, nullability, and constraints before commit.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'vessl'
  and (table_name, column_name) in
    (('companies', 'last_style_iteration'), ('quotes', 'style_number'))
order by table_name, column_name;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where (conrelid = 'vessl.companies'::regclass and conname = 'companies_last_style_iteration_nonnegative')
   or (conrelid = 'vessl.quotes'::regclass and conname = 'quotes_style_number_key')
order by conname;

-- commit;
rollback;
