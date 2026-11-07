-- 149r -- Reverse of 149. Shipment history back to status, ETD and ETA only.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. vessl.record_order_history back to the body measured on 4 Nov
-- exactly (md5 38a761d3.../1918) -- the 149 body with the shipments array put
-- back. Owner, rights, search_path and security definer are kept. The history
-- rows written while 149 was live stay; no row of any table changes.
--
-- GUARDS, before any change.
--   149 is committed -- the function is the 149 body (md5 46dfbdd2.../1988)
--   the 149 shipments array occurs exactly once in it
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre149r on commit drop as
  select
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.record_order_history()'))                                        as h_fn,
    (select (length(prosrc) - length(replace(prosrc, $q$array['status', 'estimated_departure', 'estimated_arrival', 'container_no', 'bill_of_lading', 'booking_number', 'transport_mode']$q$, '')))
            / length($q$array['status', 'estimated_departure', 'estimated_arrival', 'container_no', 'bill_of_lading', 'booking_number', 'transport_mode']$q$)
       from pg_proc where oid = to_regprocedure('vessl.record_order_history()'))                          as n_arr,
    (select p.prosecdef::text || '/' || p.proowner::regrole::text || '/' || coalesce(p.proacl::text, 'none')
            || '/' || coalesce(p.proconfig::text, 'none') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), 'none')
       from pg_proc p where p.oid = to_regprocedure('vessl.record_order_history()'))                      as h_meta,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) from vessl.shipments s)     as h_ships,
    (select count(*) from vessl.order_history)                                                             as n_hist;

do $guard$
begin
  if (select h_fn from _pre149r) is distinct from '46dfbdd2a1bf5e023bac57d36bc39503/1988' then
    raise exception 'record_order_history is not the 149 body, nothing changed';
  end if;
  if (select n_arr from _pre149r) <> 1 then
    raise exception 'the 149 shipments field list does not occur exactly once, nothing changed';
  end if;
end
$guard$;

do $fn$
declare
  body text;
begin
  select replace(prosrc,
                 $q$array['status', 'estimated_departure', 'estimated_arrival', 'container_no', 'bill_of_lading', 'booking_number', 'transport_mode']$q$,
                 $q$array['status', 'estimated_departure', 'estimated_arrival']$q$)
    into body
    from pg_proc where oid = 'vessl.record_order_history()'::regprocedure;
  execute 'create or replace function vessl.record_order_history() returns trigger language plpgsql'
       || ' security definer set search_path to vessl, pg_temp as ' || quote_literal(body);
end
$fn$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, record_order_history = ' || (select h_fn from _pre149r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the body measured on 4 Nov exactly',
         (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.record_order_history()'::regprocedure),
         '38a761d32ea39360d61880a8962547ea/1918'::text
  union all
  select 'b2 security definer, owner, rights, search_path and comment as before',
         (select p.prosecdef::text || '/' || p.proowner::regrole::text || '/' || coalesce(p.proacl::text, 'none')
                 || '/' || coalesce(p.proconfig::text, 'none') || '/' || coalesce(obj_description(p.oid, 'pg_proc'), 'none')
            from pg_proc p where p.oid = 'vessl.record_order_history()'::regprocedure),
         (select h_meta from _pre149r)
  union all
  select 'b3 no row changed, no history',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_ships from _pre149r) then 'same' else 'changed' end from vessl.shipments s)
         || '/' || ((select count(*) from vessl.order_history) - (select n_hist from _pre149r))::text,
         'same/0'::text
  union all
  select 'z0 verification ran, record_order_history = '
         || (select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = 'vessl.record_order_history()'::regprocedure),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
