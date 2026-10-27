-- 84 -- vessl.parcel_carriers, the managed list behind the sample round Carrier field.
--
-- WHAT IT DOES. Creates one table and seeds four rows. A carrier is a name and,
-- optionally, the carrier tracking page with the text {number} where the
-- tracking number goes. The round form offers the active carriers as a
-- dropdown with an Add new carrier option, and lib/tracking.js builds the link
-- from the pattern here. program_sample_rounds.carrier keeps storing the NAME as
-- text -- there is no foreign key -- so a round keeps its carrier whatever
-- happens to this list, and an old round naming a carrier nobody listed still
-- shows it.
--
-- NAMES ARE UNIQUE WHATEVER THE CASE. A unique index on lower(btrim(name)), so
-- FedEx, fedex and a trailing-space FedEx are one carrier and a second is
-- refused. The round already stored as Fedex matches FedEx that way.
--
-- THE URL IS CHECKED WHEN GIVEN. Null means no link and the number shows as
-- plain text. When set it must start with https and contain {number}, so a
-- pattern that could never produce a tracking page cannot be saved. A blank
-- name is refused too.
--
-- NO DELETE. A carrier is retired with active false and leaves the dropdown,
-- while every round that names it keeps its text and, while the row exists,
-- its link. There is no DELETE grant and the one policy is staff_only.
--
-- REVOKE FIRST, as scripts 34 and 80. The vessl schema default grants
-- authenticated arwdDxtm on every new table at CREATE time, so not granting
-- DELETE would not withhold it. Revoke everything from public, anon and
-- authenticated, then grant select, insert and update back.
--
-- THE COLON IN EACH URL is written chr(58), because the tool this runs through
-- reads a single colon as a bind parameter.
--
-- THE SEED is the four patterns lib/tracking.js uses, fetched on 2026-09-25 with
-- a dummy number. FedEx, UPS and DHL each answered 200 with their tracking page
-- and the number still in the address. USPS redirected to its tracking page with
-- the number kept and then answered a script with a bot check, which a browser
-- passes. created_by is null on the seed rows, because nobody typed them.
--
-- WHY parcel_carriers AND NOT carriers. Carrier already means a freight
-- carrier in this app -- a companies.type the New Company form offers, read by
-- the Pricing freight lists, and forwarder_bids.carrier, the shipping line on a
-- freight bid. This table holds couriers for samples, FedEx and the like, and
-- the name keeps the two apart. The label on screen is still Carrier.
--
-- MEASURED BEFORE WRITING, against the live database
--   No relation named like carrier exists in any schema. vessl.is_staff exists.
--   The vessl default ACL is authenticated arwdDxtm. Unrelated, and untouched,
--   are companies.type carrier (0 companies carry it), forwarder_bids.carrier
--   (2 bids name one) and shipments.carrier_company_id -- freight, not couriers.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre84 on commit drop as
  select (select count(*) from pg_class where relname = 'parcel_carriers') as tbl_before;

do $guard$
begin
  if (select tbl_before from _pre84) <> 0 then
    raise exception 'a relation named parcel_carriers already exists, nothing changed';
  end if;
end
$guard$;

create table vessl.parcel_carriers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  tracking_url text,
  active       boolean not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint parcel_carriers_name_not_blank check (btrim(name) <> ''),
  constraint parcel_carriers_tracking_url_shape
    check (tracking_url is null
           or (tracking_url like 'https%' and position('{number}' in tracking_url) > 0))
);

create unique index parcel_carriers_name_ci on vessl.parcel_carriers (lower(btrim(name)));

comment on table vessl.parcel_carriers is
  'Couriers a sample round can name. tracking_url holds the tracking page with {number} where the number goes; null means no link. Retired with active false, never deleted. program_sample_rounds.carrier stores the name as text.';

alter table vessl.parcel_carriers enable row level security;

create policy staff_only on vessl.parcel_carriers
  as permissive for all to authenticated
  using (vessl.is_staff())
  with check (vessl.is_staff());

-- Revoke first. The schema default already granted everything at CREATE time.
revoke all on vessl.parcel_carriers from public, anon, authenticated;
grant select, insert, update on vessl.parcel_carriers to authenticated;

insert into vessl.parcel_carriers (name, tracking_url) values
  ('FedEx', 'https' || chr(58) || '//www.fedex.com/wtrk/track/?trknbr={number}'),
  ('UPS',   'https' || chr(58) || '//www.ups.com/track?loc=en_US&tracknum={number}'),
  ('USPS',  'https' || chr(58) || '//tools.usps.com/go/TrackConfirmAction?tLabels={number}'),
  ('DHL',   'https' || chr(58) || '//www.dhl.com/us-en/home/tracking.html?tracking-id={number}&submit=1');

-- PROBES. Five inserts, each in its own subtransaction. The four the rules must
-- refuse are refused by Postgres. The fifth is valid, is accepted, and is then
-- undone by raising accepted, so none of the five survives -- d1 counts four.
create temp table _probe84 (n int, result text) on commit drop;

do $probe$
declare
  names text[] := array['fedex ', 'ZZ probe one', '  ', 'ZZ probe two', 'ZZ probe three'];
  urls  text[] := array[null, 'https' || chr(58) || '//example.com/track', null,
                        'http' || chr(58) || '//example.com/t?n={number}', 'https' || chr(58) || '//example.com/t?n={number}'];
  r text;
begin
  for i in 1 .. 5 loop
    begin
      insert into vessl.parcel_carriers (name, tracking_url) values (names[i], urls[i]);
      raise exception 'accepted';
    exception
      when unique_violation then r := 'duplicate';
      when check_violation  then r := 'refused';
      when others           then r := sqlerrm;
    end;
    insert into _probe84 values (i, r);
  end loop;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 no parcel_carriers relation existed before' as chk,
         (select tbl_before::text from _pre84) as got, '0' as want
  union all
  select 'b1 the table exists now in vessl',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'parcel_carriers' and c.relkind = 'r'), '1'
  union all
  select 'b2 six columns, exactly the ones named',
         (select count(*)::text || '/' ||
                 count(*) filter (where column_name in ('id', 'name', 'tracking_url', 'active',
                                                        'created_by', 'created_at'))::text
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'parcel_carriers'), '6/6'
  union all
  select 'b3 the case-insensitive unique index exists',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'parcel_carriers' and indexname = 'parcel_carriers_name_ci'
             and indexdef like '%UNIQUE%' and indexdef like '%lower(btrim(name))%'), '1'
  union all
  -- THE RULES TESTED, not just found. A second FedEx in other case, a url with
  -- no {number}, a blank name, a plain http url, then a valid row.
  select 'b4 probes -- dup name, url without number, blank name, http url, then a valid row',
         (select string_agg(result, '/' order by n) from _probe84),
         'duplicate/refused/refused/refused/accepted'
  union all
  select 'c1 row level security is on and not forced',
         (select relrowsecurity::text || '/' || relforcerowsecurity::text
            from pg_class where oid = 'vessl.parcel_carriers'::regclass), 'true/false'
  union all
  select 'c2 one policy, staff_only, permissive, all commands, is_staff both ways',
         (select string_agg(polname || '/' || polpermissive::text || '/' || polcmd::text || '/'
                            || pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid), ', ')
            from pg_policy where polrelid = 'vessl.parcel_carriers'::regclass),
         'staff_only/true/*/vessl.is_staff()/vessl.is_staff()'
  union all
  select 'c3 the ACL is exactly the owner plus authenticated arw',
         (select relacl::text from pg_class where oid = 'vessl.parcel_carriers'::regclass),
         '{postgres=arwdDxtm/postgres,authenticated=arw/postgres}'
  union all
  select 'c4 authenticated may not delete or truncate, anon reaches nothing',
         (select has_table_privilege('authenticated', 'vessl.parcel_carriers', 'DELETE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.parcel_carriers', 'TRUNCATE')::text || '/' ||
                 has_table_privilege('anon', 'vessl.parcel_carriers', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.parcel_carriers', 'INSERT')::text),
         'false/false/false/false'
  union all
  -- THE SEED. Four rows, all active, no probe left behind, each with the
  -- pattern lib/tracking.js uses.
  select 'd1 exactly four carriers, all active, all unattributed',
         (select count(*)::text || '/' || count(*) filter (where active)::text || '/' ||
                 count(created_by)::text from vessl.parcel_carriers), '4/4/0'
  union all
  select 'd2 the four names',
         (select string_agg(name, ',' order by name) from vessl.parcel_carriers), 'DHL,FedEx,UPS,USPS'
  union all
  select 'd3 each pattern, filled with a sample number, is the url the app links today',
         (select count(*)::text from vessl.parcel_carriers c
            join (values
              ('FedEx', 'https' || chr(58) || '//www.fedex.com/wtrk/track/?trknbr=123456789012'),
              ('UPS',   'https' || chr(58) || '//www.ups.com/track?loc=en_US&tracknum=123456789012'),
              ('USPS',  'https' || chr(58) || '//tools.usps.com/go/TrackConfirmAction?tLabels=123456789012'),
              ('DHL',   'https' || chr(58) || '//www.dhl.com/us-en/home/tracking.html?tracking-id=123456789012&submit=1')
            ) v(name, url) on v.name = c.name
           where replace(c.tracking_url, '{number}', '123456789012') = v.url), '4'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
