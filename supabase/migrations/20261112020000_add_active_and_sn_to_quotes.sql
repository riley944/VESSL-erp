-- Prepare per-company style counters and nullable, unique quote style numbers.
-- Number allocation and backfilling existing quotes are separate work.
alter table vessl.companies
  add column last_style_iteration integer not null default 0,
  add constraint companies_last_style_iteration_nonnegative
    check (last_style_iteration >= 0);

alter table vessl.quotes
  add column style_number text,
  add column active boolean not null default true,
  add constraint quotes_style_number_key unique (style_number);

comment on column vessl.companies.last_style_iteration is
  'Last style iteration assigned to this client; zero means none assigned.';
comment on column vessl.quotes.style_number is
  'Unique client style number; NULL for quotes not yet assigned one.';
