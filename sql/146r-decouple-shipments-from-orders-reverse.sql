-- 146r -- Reverse of 146. Shipments and orders move each other again.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES.
--   1. Drops trigger trg_sync_so_status_down and the 146 function
--      vessl.sync_so_status_down(), renames sync_so_status_down_pre146 back to
--      sync_so_status_down -- the pre-146 body, byte for byte -- and creates the
--      trigger again on it, same definition. Its comment goes back to none.
--   2. Creates trigger trg_sync_shipment_status on vessl.shipments again, on the
--      unchanged vessl.sync_shipment_status(). Its comment goes back to none.
-- No row of any table changes. Statuses that drifted apart while 146 was live
-- stay as they are; the next status change on either side syncs as before 146.
--
-- GUARDS, before any change.
--   146 is committed -- trg_sync_shipment_status absent, the pre146 body there
--   and unattached, the SO trigger on the 146 body (md5 b89dbb84, 1168)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre146r on commit drop as
  select
    (select count(*) from pg_trigger where tgname = 'trg_sync_shipment_status')                                    as n_trg_ship,
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.sync_so_status_down_pre146()'))                                             as h_pre146,
    (select md5(prosrc) || '/' || length(prosrc) from pg_proc
      where oid = to_regprocedure('vessl.sync_shipment_status()'))                                                   as h_ship_fn,
    (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgname = 'trg_sync_so_status_down' and p.proname = 'sync_so_status_down'
        and md5(p.prosrc) = 'b89dbb84c925b78948687dcd7596fd1f' and length(p.prosrc) = 1168)                          as n_new;

do $guard$
begin
  if (select n_trg_ship from _pre146r) <> 0
     or (select h_pre146 from _pre146r) is distinct from 'd20e88485af499d009533b83aded4bff/2252'
     or (select h_ship_fn from _pre146r) is distinct from 'ab3b5f4d7a49921153e67937a1c851eb/1682'
     or (select n_new from _pre146r) <> 1 then
    raise exception '146 is not committed as written, nothing changed';
  end if;
end
$guard$;

drop trigger trg_sync_so_status_down on vessl.sales_orders;
drop function vessl.sync_so_status_down();
alter function vessl.sync_so_status_down_pre146() rename to sync_so_status_down;
comment on function vessl.sync_so_status_down() is null;
create trigger trg_sync_so_status_down after update of status on vessl.sales_orders
  for each row execute function vessl.sync_so_status_down();

create trigger trg_sync_shipment_status after update of status on vessl.shipments
  for each row execute function vessl.sync_shipment_status();
comment on function vessl.sync_shipment_status() is null;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, shipment trigger present = ' || (select n_trg_ship::text from _pre146r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 both triggers back on the pre-146 bodies',
         (select p.proname || ' ' || md5(p.prosrc) || '/' || length(p.prosrc) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgname = 'trg_sync_so_status_down')
         || ', ' || (select p.proname || ' ' || md5(p.prosrc) || '/' || length(p.prosrc) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgname = 'trg_sync_shipment_status'),
         'sync_so_status_down d20e88485af499d009533b83aded4bff/2252, sync_shipment_status ab3b5f4d7a49921153e67937a1c851eb/1682'::text
  union all
  select 'b2 no 146 function left',
         (select count(*)::text from pg_proc where proname = 'sync_so_status_down_pre146'),
         '0'::text
  union all
  select 'z0 verification ran',
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
