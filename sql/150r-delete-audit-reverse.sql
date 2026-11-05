-- 150r -- Reverse of 150. Delete logging off.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. Drops the three trg_log_delete triggers (shipment_quotes,
-- forwarder_bids, quotes) and vessl.log_delete(). KEEPS every audit_log row
-- and the actor_email column that holds them. Deliberately NOT reversed -- the
-- audit_log policies and rights stay as 150 left them (staff read, postgres
-- alone writes). Putting back audit_log_auth_all and staff_only would let any
-- signed-in user edit or delete the rows this keeps. audit_log_actor_id_fkey
-- is not put back either -- the kept rows hold auth user ids, which the empty
-- vessl.app_users it referenced would refuse. No other row changes.
--
-- GUARDS, before any change.
--   150 is committed -- vessl.log_delete exists with the Script 150 comment,
--   and trg_log_delete is on exactly the three tables
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre150r on commit drop as
  select
    (select left(obj_description(oid, 'pg_proc'), 11) from pg_proc where oid = to_regprocedure('vessl.log_delete()')) as fn_comment,
    (select string_agg(c.relname, ', ' order by c.relname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'trg_log_delete')            as h_trg,
    (select count(*) from vessl.audit_log)                                                                 as n_audit,
    (select md5(coalesce(string_agg(to_jsonb(l)::text, '/' order by l.id), '')) from vessl.audit_log l)    as h_audit,
    (select string_agg(polname || ' ' || polpermissive::text || ' ' || polcmd::text, ', ' order by polname)
       from pg_policy where polrelid = 'vessl.audit_log'::regclass)
      || ' / ' || (select relacl::text from pg_class where oid = 'vessl.audit_log'::regclass)              as h_rights;

do $guard$
begin
  if (select fn_comment from _pre150r) is distinct from 'Script 150.' then
    raise exception 'vessl.log_delete is not the 150 function, nothing changed';
  end if;
  if (select h_trg from _pre150r) is distinct from 'forwarder_bids, quotes, shipment_quotes' then
    raise exception 'trg_log_delete is not on exactly the three tables, nothing changed';
  end if;
end
$guard$;

drop trigger trg_log_delete on vessl.shipment_quotes;
drop trigger trg_log_delete on vessl.forwarder_bids;
drop trigger trg_log_delete on vessl.quotes;
drop function vessl.log_delete();

comment on table vessl.audit_log is 'Script 150, reversed by 150r. The delete log for shipment_quotes, forwarder_bids and quotes while 150 was live; nothing writes it now. Staff may read it; only postgres writes, updates or deletes it.';

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, trg_log_delete on ' || (select h_trg from _pre150r) || ', audit_log rows ' || (select n_audit from _pre150r)::text as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 no trg_log_delete, no log_delete',
         (select count(*) from pg_trigger where tgname = 'trg_log_delete')::text
         || '/' || (select count(*) from pg_proc where proname = 'log_delete' and pronamespace = 'vessl'::regnamespace)::text,
         '0/0'::text
  union all
  select 'b2 every audit_log row kept, rights as 150 left them',
         (select case when md5(coalesce(string_agg(to_jsonb(l)::text, '/' order by l.id), '')) = (select h_audit from _pre150r) then 'same' else 'changed' end from vessl.audit_log l)
         || ' / ' || (select string_agg(polname || ' ' || polpermissive::text || ' ' || polcmd::text, ', ' order by polname)
                        from pg_policy where polrelid = 'vessl.audit_log'::regclass)
         || ' / ' || (select relacl::text from pg_class where oid = 'vessl.audit_log'::regclass),
         'same / ' || (select h_rights from _pre150r)
  union all
  select 'b3 trg_quote_code still on quotes, enabled',
         (select md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text from pg_trigger t
           where t.tgrelid = 'vessl.quotes'::regclass and t.tgname = 'trg_quote_code'),
         'b7fd53764c316169a42bfd3d0ebfddae/O'::text
  union all
  select 'z0 verification ran, audit_log rows ' || (select count(*) from vessl.audit_log)::text,
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
