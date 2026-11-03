-- 147 -- How a shipment travels -- shipments.transport_mode.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 147r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. Run this BEFORE deploying the code that names the column
-- (round 7) -- the New Shipment form writes it when a mode other than ocean is
-- chosen, and the card saves it when it changes.
--
-- WHAT IT DOES. One column on vessl.shipments --
--   transport_mode text not null default ocean, CHECK shipments_transport_mode
--   (ocean, air, courier), with a comment.
-- Every existing row takes ocean from the default as the column is added -- no
-- trigger fires for that, so order_history records nothing and updated_at does
-- not move. No other column, row or table is touched. No grant or policy change
-- -- the column falls under the table grants and RLS shipments already has.
-- Tracking (ShipsGo) stays ocean only; the app keeps air and courier manual.
--
-- GUARDS, before any change.
--   the column does not exist yet
--   shipments has only the CHECK measured (shipments_tracking_provider_check)
--   no ZZ-147-PROBE shipment
--
-- PROBES, each undone.
--   p1 As Jenn signed in, a throwaway ZZ-147-PROBE shipment made with no mode
--      reads ocean, and set to air reads air.
--   p2 As Jenn, setting the mode to rail is refused (23514).
--   p3 As Jenn, setting the mode to null is refused (23502).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre147 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'transport_mode')      as n_col,
    (select string_agg(conname, ', ' order by conname) from pg_constraint
      where conrelid = 'vessl.shipments'::regclass and contype = 'c')                                       as checks,
    (select count(*) from vessl.shipments where shipment_number = 'ZZ-147-PROBE')                           as n_probe,
    (select count(*) from vessl.shipments)                                                                  as n_rows,
    (select count(*) from vessl.order_history)                                                              as n_hist,
    -- Every row, every column, so b3 can prove nothing but the new column moved.
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)      as h_rows;

do $guard$
begin
  if (select n_col from _pre147) <> 0 then
    raise exception 'shipments already has transport_mode, nothing changed';
  end if;
  if (select checks from _pre147) is distinct from 'shipments_tracking_provider_check' then
    raise exception 'the CHECK constraints on shipments are not as measured, nothing changed';
  end if;
  if (select n_probe from _pre147) <> 0 then
    raise exception 'a ZZ-147-PROBE shipment exists, nothing changed';
  end if;
end
$guard$;

alter table vessl.shipments add column transport_mode text not null default 'ocean'
  constraint shipments_transport_mode check (transport_mode in ('ocean', 'air', 'courier'));

comment on column vessl.shipments.transport_mode is 'Script 147. How the shipment travels -- ocean (the default, every row before 147), air or courier. Chooses the words the app uses for its status and fields. ShipsGo tracking is ocean only.';

create temp table _probe147 (step int, result text) on commit drop;

do $probe$
declare
  st  text;
  sh  uuid;
  msg text;
begin
  -- p1, as Jenn -- made without a mode, then air.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.shipments (shipment_number, status) values ('ZZ-147-PROBE', 'created') returning id into sh;
    select 'made ' || transport_mode into msg from vessl.shipments where id = sh;
    update vessl.shipments set transport_mode = 'air' where id = sh;
    select msg || ' then ' || transport_mode into msg from vessl.shipments where id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe147 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- p2, as Jenn -- rail.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.shipments (shipment_number, status) values ('ZZ-147-PROBE', 'created') returning id into sh;
    update vessl.shipments set transport_mode = 'rail' where id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe147 values (2, case when st = 'P0001' then 'allowed' else st end);
  end;

  -- p3, as Jenn -- null.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.shipments (shipment_number, status) values ('ZZ-147-PROBE', 'created') returning id into sh;
    update vessl.shipments set transport_mode = null where id = sh;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe147 values (3, case when st = 'P0001' then 'allowed' else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipments = ' || (select n_rows::text from _pre147) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 column -- text, not null, default ocean, CHECK ocean air courier',
         (select data_type || '/' || is_nullable || '/' || column_default from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'transport_mode')
         || '/' || (select pg_get_constraintdef(oid) from pg_constraint where conname = 'shipments_transport_mode'),
         'text/NO/''ocean''::text/CHECK ((transport_mode = ANY (ARRAY[''ocean''::text, ''air''::text, ''courier''::text])))'::text
  union all
  select 'b2 every row ocean',
         (select count(*)::text || '/' || count(*) filter (where transport_mode = 'ocean')::text from vessl.shipments),
         (select n_rows::text || '/' || n_rows::text from _pre147)
  union all
  select 'b3 nothing else on any row changed, no history written',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'transport_mode')::text, '/' order by s.id), ''))
                           = (select h_rows from _pre147) then 'same' else 'changed' end from vessl.shipments s)
         || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre147))::text,
         'same/0'::text
  union all
  select 'b4 probes -- default and air allowed, rail and null refused',
         (select string_agg(result, ' || ' order by step) from _probe147),
         'made ocean then air || 23514 || 23502'::text
  union all
  select 'b5 no probe row left',
         (select count(*)::text from vessl.shipments where shipment_number = 'ZZ-147-PROBE'), '0'::text
  union all
  select 'z0 verification ran, shipments by mode = '
         || (select string_agg(transport_mode || ' ' || n::text, ', ' order by transport_mode)
               from (select transport_mode, count(*) n from vessl.shipments group by transport_mode) x),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
