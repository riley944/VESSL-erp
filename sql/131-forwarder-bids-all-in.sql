-- 131 -- Forwarder bids can be marked all-in, in forwarder_bids.all_in.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 131r.
-- Run this BEFORE the code that writes it is deployed -- Add bid by hand and the
-- sheet import save the column. The code now live never names it, so adding it
-- changes nothing for the live site.
--
-- WHAT IT DOES. One column and a comment, nothing else.
--   all_in, boolean not null default false. True means the forwarder quoted one
--   all-in price with no additional fees -- the bid is that one total (per
--   container for FCL, for the shipment for LCL) with no breakdown. Every
--   existing bid reads false -- the default fills them, no backfill.
--
-- NO GRANT CHANGES. authenticated holds its privileges ON THE TABLE, and a
-- table grant covers a column added later. The guard checks no column carries
-- a column-level grant. Probe p1 proves a signed-in staff user can write it.
--
-- TRIGGERS. forwarder_bids has none. RLS is the one policy staff_only, for all
-- commands, on vessl.is_staff() -- unchanged.
--
-- GUARDS, before any change.
--   all_in does not exist yet
--   no column of the table has a column-level grant
--
-- PROBES, each undone.
--   p1 As Jenn signed in through the app, a bid saved with all_in true on an
--      existing freight quote is accepted.
--   p2 As postgres, a bid saved without naming all_in reads false.
--   p3 As postgres, all_in null is refused (23502).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the count before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre131 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'forwarder_bids'
        and column_name = 'all_in')                                                              as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.forwarder_bids'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.forwarder_bids)                                                  as n_bids,
    -- Every bid, every column, so b4 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.id), ''))
       from vessl.forwarder_bids b)                                                              as h_rows;

do $guard$
begin
  if (select has_col from _pre131) <> 0 then
    raise exception 'forwarder_bids.all_in already exists, nothing changed';
  end if;
  if (select n_colacl from _pre131) <> 0 then
    raise exception 'a column of forwarder_bids has a column-level grant, so the new column may need one too, nothing changed';
  end if;
end
$guard$;

alter table vessl.forwarder_bids add column all_in boolean not null default false;
comment on column vessl.forwarder_bids.all_in is
  'Script 131. True when the forwarder quoted one all-in price with no additional fees. The bid is then that one total (effective_per_container per container for FCL, rates LCL total for LCL) with no breakdown, and Apply bid adds it as a single Freight (all-in) leg.';

create temp table _probe131 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
  sq uuid;
  v text;
begin
  select id into sq from vessl.shipment_quotes order by created_at limit 1;

  -- p1, as a signed-in staff user -- a bid saved all-in.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.forwarder_bids (shipment_quote_id, forwarder_name, effective_per_container, all_in)
      values (sq, 'ZZ-131-PROBE', 2030, true);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe131 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2, as postgres -- all_in not named reads false.
  begin
    insert into vessl.forwarder_bids (shipment_quote_id, forwarder_name) values (sq, 'ZZ-131-PROBE')
      returning all_in::text into v;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe131 values (2, case when st = 'P0001' then 'default ' || v else st end);
  end;

  -- p3, as postgres -- null refused.
  begin
    insert into vessl.forwarder_bids (shipment_quote_id, forwarder_name, all_in) values (sq, 'ZZ-131-PROBE', null);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe131 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, forwarder bids = ' || (select n_bids::text from _pre131) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 all_in exists, boolean, not null, default false',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'forwarder_bids' and column_name = 'all_in')::text,
         'boolean/NO/false'::text
  union all
  select 'b2 the column carries its comment',
         (select (col_description('vessl.forwarder_bids'::regclass,
                   (select attnum from pg_attribute where attrelid = 'vessl.forwarder_bids'::regclass and attname = 'all_in'))
                  like 'Script 131.%')::text),
         'true'::text
  union all
  select 'b3 every bid unchanged, all_in false on all',
         (select case when md5(coalesce(string_agg((to_jsonb(b) - 'all_in')::text, '/' order by b.id), ''))
                           = (select h_rows from _pre131) then 'same' else 'changed' end
                 || '/' || count(*) filter (where all_in)::text
            from vessl.forwarder_bids b),
         'same/0'::text
  union all
  select 'b4 same number of bids, probes left nothing',
         (select count(*)::text from vessl.forwarder_bids), (select n_bids::text from _pre131)
  union all
  select 'b5 probes -- staff saves all-in; default false; null refused',
         (select string_agg(result, ' | ' order by step) from _probe131),
         'allowed 1 | default false | 23502'::text
  union all
  select 'b6 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.forwarder_bids'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, all-in bids = '
           || (select count(*)::text from vessl.forwarder_bids where all_in),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
