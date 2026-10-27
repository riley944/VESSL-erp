-- 85 -- Parcel carriers become companies of type carrier; parcel_carriers goes.
--
-- WHAT IT DOES. Three steps, in one transaction.
--   1. Adds companies.tracking_url, nullable text, with the CHECK script 84 put
--      on parcel_carriers -- null, or starting with https and containing
--      {number} where the tracking number goes. Every company but the new
--      carriers leaves it null.
--   2. Copies every row of vessl.parcel_carriers into vessl.companies as type
--      carrier, name and tracking_url as they are. Today that is the four seed
--      rows, FedEx, UPS, USPS and DHL -- nothing was added after script 84, and
--      no Zorbo exists. The copy reads the table rather than naming the four,
--      so a row added before this runs comes across too, and the guard stops
--      the script if any name would collide with an existing carrier company.
--   3. Drops vessl.parcel_carriers. Nothing outside it depends on it -- its
--      only dependants are its own index, constraints, defaults and policy,
--      which go with it. A plain drop, no cascade, so anything unexpected
--      stops the script instead of going too.
--
-- NO GRANT OR POLICY CHANGE ON companies. authenticated holds table level
-- arwdDxtm and no column carries a grant, so the new column is covered like
-- the others. The three policies are left exactly as they are. c1 and c2
-- assert both against snapshots taken before any DDL.
--
-- EVERY OTHER COMPANY IS UNTOUCHED, proven by hashing all thirteen existing
-- columns of the forty rows before and after (b6).
--
-- THE COLON IN EACH URL is written chr(58), because the tool this runs through
-- reads a single colon as a bind parameter.
--
-- MEASURED BEFORE WRITING, against the live database
--   companies -- 40 rows, 28 client, 9 factory, 3 freight_forwarder, none of
--   type carrier, none named FedEx, UPS, USPS, DHL or Zorbo in any type. 13
--   columns, no tracking_url. UNIQUE (name, type). ACL postgres arwdDxtm and
--   authenticated arwdDxtm. Three policies -- kui_staff_only restrictive,
--   companies_auth_all and staff_only permissive. No trigger. The type enum
--   carries carrier.
--   parcel_carriers -- 4 rows, the seed, all active, created_by null.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre85 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies'
             and column_name = 'tracking_url')                                        as col_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies')                 as cols_before,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'parcel_carriers')               as pc_exists,
         (select count(*) from vessl.companies)                                       as companies_before,
         (select count(*) from vessl.companies where type::text = 'carrier')          as carriers_before,
         (select md5(coalesce(string_agg(concat_ws('|', id, name, type, email, phone, website, created_at,
                                                   updated_at, vendor_number, pallet_info, po_notes,
                                                   billing_address, shipping_address), '/' order by id), ''))
            from vessl.companies)                                                     as hash_before,
         (select relacl::text from pg_class where oid = 'vessl.companies'::regclass)  as acl_before,
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'vessl.companies'::regclass)              as pols_before;

-- What moves, kept past the drop so the checks can compare against it.
create temp table _move85 on commit drop as
  select name, tracking_url from vessl.parcel_carriers;

do $guard$
begin
  if (select col_before from _pre85) <> 0 then
    raise exception 'companies already has tracking_url, nothing changed';
  end if;
  if (select pc_exists from _pre85) <> 1 then
    raise exception 'vessl.parcel_carriers does not exist, nothing changed';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'vessl.company_type'::regtype
                                         and enumlabel = 'carrier') then
    raise exception 'company_type has no carrier value, nothing changed';
  end if;
  if exists (select 1 from vessl.companies c join _move85 m
               on lower(btrim(c.name)) = lower(btrim(m.name))
             where c.type::text = 'carrier') then
    raise exception 'a carrier company already has one of these names, nothing changed';
  end if;
end
$guard$;

alter table vessl.companies
  add column tracking_url text;

alter table vessl.companies
  add constraint companies_tracking_url_shape
  check (tracking_url is null
         or (tracking_url like 'https%' and position('{number}' in tracking_url) > 0));

comment on column vessl.companies.tracking_url is
  'For a parcel carrier -- the carrier tracking page with {number} where the tracking number goes. Null means no link. Other company types leave it null.';

insert into vessl.companies (name, type, tracking_url)
select m.name, 'carrier', m.tracking_url from _move85 m;

drop table vessl.parcel_carriers;

-- PROBES. Two inserts, each in its own subtransaction -- a carrier whose url
-- has no {number}, refused, and a valid one, accepted and then undone by
-- raising accepted. Neither survives; b3 counts the carriers.
create temp table _probe85 (n int, result text) on commit drop;

do $probe$
declare
  urls text[] := array['https' || chr(58) || '//example.com/track',
                       'https' || chr(58) || '//example.com/t?n={number}'];
  r text;
begin
  for i in 1 .. 2 loop
    begin
      insert into vessl.companies (name, type, tracking_url) values ('ZZ probe carrier ' || i, 'carrier', urls[i]);
      raise exception 'accepted';
    exception
      when check_violation then r := 'refused';
      when others          then r := sqlerrm;
    end;
    insert into _probe85 values (i, r);
  end loop;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 tracking_url did not exist and parcel_carriers did' as chk,
         (select col_before::text || '/' || pc_exists::text from _pre85) as got, '0/1' as want
  union all
  select 'a1 no carrier companies before, and the rows to move',
         (select carriers_before::text from _pre85) || '/' || (select count(*)::text from _move85), '0/4'
  union all
  select 'b1 tracking_url exists, text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies' and column_name = 'tracking_url'),
         'text/YES/none'
  union all
  select 'b2 exactly one column added',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'companies') - cols_before)::text
            from _pre85), '1'
  union all
  select 'b3 every moved row is a carrier company with the same url, and nothing else is a carrier',
         (select count(*)::text from vessl.companies c join _move85 m
            on c.name = m.name and c.tracking_url is not distinct from m.tracking_url
           where c.type::text = 'carrier') || '/' ||
         (select count(*)::text from vessl.companies where type::text = 'carrier'),
         (select count(*)::text || '/' || count(*)::text from _move85)
  union all
  select 'b4 the four carriers by name',
         (select string_agg(name, ',' order by name) from vessl.companies where type::text = 'carrier'),
         'DHL,FedEx,UPS,USPS'
  union all
  select 'b5 each pattern, filled with a sample number, is the url the app links today',
         (select count(*)::text from vessl.companies c
            join (values
              ('FedEx', 'https' || chr(58) || '//www.fedex.com/wtrk/track/?trknbr=123456789012'),
              ('UPS',   'https' || chr(58) || '//www.ups.com/track?loc=en_US&tracknum=123456789012'),
              ('USPS',  'https' || chr(58) || '//tools.usps.com/go/TrackConfirmAction?tLabels=123456789012'),
              ('DHL',   'https' || chr(58) || '//www.dhl.com/us-en/home/tracking.html?tracking-id=123456789012&submit=1')
            ) v(name, url) on v.name = c.name
           where c.type::text = 'carrier'
             and replace(c.tracking_url, '{number}', '123456789012') = v.url), '4'
  union all
  -- EVERY COMPANY THAT WAS THERE IS EXACTLY AS IT WAS, and none of them gained
  -- a tracking url.
  select 'b6 the forty existing companies are unchanged and carry no tracking url',
         (select md5(coalesce(string_agg(concat_ws('|', id, name, type, email, phone, website, created_at,
                                                   updated_at, vendor_number, pallet_info, po_notes,
                                                   billing_address, shipping_address), '/' order by id), ''))
                 || '/' || count(tracking_url)::text
            from vessl.companies where type::text <> 'carrier'),
         (select hash_before || '/0' from _pre85)
  union all
  select 'b7 the company count rose by exactly the rows moved',
         (select ((select count(*) from vessl.companies) - companies_before)::text from _pre85),
         (select count(*)::text from _move85)
  union all
  select 'b8 probes -- a url without number, then a valid carrier',
         (select string_agg(result, '/' order by n) from _probe85), 'refused/accepted'
  union all
  select 'c1 the grant on companies is unchanged, and no column carries its own',
         (select relacl::text from pg_class where oid = 'vessl.companies'::regclass) || '/' ||
         (select count(*)::text from pg_attribute where attrelid = 'vessl.companies'::regclass and attacl is not null),
         (select acl_before || '/0' from _pre85)
  union all
  select 'c2 the three policies on companies are unchanged',
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'vessl.companies'::regclass),
         (select pols_before from _pre85)
  union all
  select 'c3 authenticated may read and write tracking_url',
         (select has_column_privilege('authenticated', 'vessl.companies', 'tracking_url', 'SELECT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.companies', 'tracking_url', 'INSERT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.companies', 'tracking_url', 'UPDATE')::text),
         'true/true/true'
  union all
  select 'd1 parcel_carriers is gone',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname in ('parcel_carriers', 'parcel_carriers_name_ci')), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
