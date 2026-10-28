-- 136 -- KUI as importer of record, a flag on companies and on products.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 136r.
-- Run this BEFORE the code that reads it is deployed -- the Testing and Samples
-- selects will name these columns, and a select naming a column the database
-- does not have fails the whole query. The code now live never names them, so
-- adding them changes nothing for the live site.
--
-- WHAT IT DOES. Two columns, their comments, nothing else.
--   companies.kui_ior  boolean null  true = KUI is the importer of record for
--                                    this client, false = the client is,
--                                    null = unknown
--   products.kui_ior   boolean null  true or false overrides the client company,
--                                    null = use the company value
-- No default and no backfill -- every company reads unknown and every product
-- reads use the company. products.importer_of_record (text, 0 values on
-- 28 Oct) is left in place; a later script drops it once no code names it.
--
-- NO GRANT OR POLICY CHANGES. Both tables are staff only (kui_staff_only,
-- restrictive, plus staff_only). Table grants cover columns added later, and the
-- guard checks no column carries a column-level grant. Neither table has a
-- trigger, so the probes write nothing beyond their own row.
--
-- GUARDS, before any change.
--   neither kui_ior column exists yet
--   products.importer_of_record still exists as text
--   the probe rows are as measured -- ZZTESTER, a client, name length 8;
--     ZZTEST2, sku length 7
--   no column of either table has a column-level grant, neither has a trigger
--
-- PROBES, each undone. Jenn is staff; the other user is signed in, not staff.
--   p1 As Jenn, setting kui_ior true on the company ZZTESTER updates 1 row.
--   p2 As Jenn, setting kui_ior false on the product ZZTEST2 updates 1 row.
--   p3 As the user who is not staff, the p1 update reaches no row (0).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre136 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name in ('companies', 'products')
        and column_name = 'kui_ior')                                                             as n_cols,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'products'
        and column_name = 'importer_of_record' and data_type = 'text')                           as n_ior_text,
    (select count(*) from vessl.companies
      where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid
        and type = 'client' and length(name) = 8)                                                as n_probe_co,
    (select count(*) from vessl.products
      where id = 'aefcaa56-fb6c-4889-b804-51bea0ae8721'::uuid and length(sku) = 7)              as n_probe_prod,
    (select count(*) from pg_attribute
      where attrelid in ('vessl.companies'::regclass, 'vessl.products'::regclass)
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from pg_trigger
      where not tgisinternal
        and tgrelid in ('vessl.companies'::regclass, 'vessl.products'::regclass))               as n_trig,
    (select count(*) from vessl.companies)                                                       as n_co,
    (select count(*) from vessl.products)                                                        as n_prod,
    -- Every row, every column, so b4 and b5 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
       from vessl.companies c)                                                                   as h_co,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), ''))
       from vessl.products p)                                                                    as h_prod;

do $guard$
begin
  if (select n_cols from _pre136) <> 0 then
    raise exception 'a kui_ior column already exists, nothing changed';
  end if;
  if (select n_ior_text from _pre136) <> 1 then
    raise exception 'products.importer_of_record is not there as text, nothing changed';
  end if;
  if (select n_probe_co from _pre136) <> 1 or (select n_probe_prod from _pre136) <> 1 then
    raise exception 'a probe row (ZZTESTER or ZZTEST2) is not as measured, nothing changed';
  end if;
  if (select n_colacl from _pre136) <> 0 then
    raise exception 'a column of companies or products has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
  if (select n_trig from _pre136) <> 0 then
    raise exception 'companies or products now has a trigger, so the probes may write elsewhere, nothing changed';
  end if;
end
$guard$;

alter table vessl.companies add column kui_ior boolean;
alter table vessl.products  add column kui_ior boolean;

comment on column vessl.companies.kui_ior is 'Script 136. Importer of record for this client. True = KUI is. False = the client is. Null = unknown.';
comment on column vessl.products.kui_ior is 'Script 136. Importer of record override for this product. True = KUI is. False = the client is. Null = use the client company value (companies.kui_ior via client_company_id).';

create temp table _probe136 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
begin
  -- p1, as Jenn -- the company.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.companies set kui_ior = true where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe136 values (1, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;

  -- p2, as Jenn -- the product.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.products set kui_ior = false where id = 'aefcaa56-fb6c-4889-b804-51bea0ae8721'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe136 values (2, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;

  -- p3, as a signed-in user who is not staff -- the p1 update.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001360', 'email', 'zz136-outsider@vessl.io', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.companies set kui_ior = true where id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe136 values (3, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, companies/products = ' || (select n_co::text || '/' || n_prod::text from _pre136) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 two kui_ior columns, boolean, nullable, no default',
         (select count(*)::text || '/' || count(*) filter (where data_type = 'boolean' and is_nullable = 'YES' and column_default is null)::text
            from information_schema.columns
           where table_schema = 'vessl' and table_name in ('companies', 'products') and column_name = 'kui_ior'),
         '2/2'::text
  union all
  select 'b2 both columns carry the script 136 comment',
         (select count(*)::text from pg_attribute
           where attrelid in ('vessl.companies'::regclass, 'vessl.products'::regclass)
             and attname = 'kui_ior' and col_description(attrelid, attnum) like 'Script 136.%'),
         '2'::text
  union all
  select 'b3 every row reads null, companies/products',
         (select count(kui_ior)::text from vessl.companies) || '/' || (select count(kui_ior)::text from vessl.products),
         '0/0'::text
  union all
  select 'b4 every existing company column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(c) - 'kui_ior')::text, '/' order by c.id), ''))
                           = (select h_co from _pre136) then 'same' else 'changed' end
            from vessl.companies c),
         'same'::text
  union all
  select 'b5 every existing product column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(p) - 'kui_ior')::text, '/' order by p.id), ''))
                           = (select h_prod from _pre136) then 'same' else 'changed' end
            from vessl.products p),
         'same'::text
  union all
  select 'b6 probes -- staff sets the company, staff sets the product, non-staff reaches nothing',
         (select string_agg(result, ' | ' order by step) from _probe136),
         'updated 1 | updated 1 | updated 0'::text
  union all
  select 'b7 importer_of_record still there as text, still no column-level grants',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'
             and column_name = 'importer_of_record' and data_type = 'text')
           || '/' || (select count(*)::text from pg_attribute
                       where attrelid in ('vessl.companies'::regclass, 'vessl.products'::regclass)
                         and attnum > 0 and not attisdropped and attacl is not null),
         '1/0'::text
  union all
  select 'z0 verification ran, companies/products = '
           || (select count(*)::text from vessl.companies) || '/' || (select count(*)::text from vessl.products),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
