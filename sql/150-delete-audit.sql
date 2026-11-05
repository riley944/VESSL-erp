-- 150 -- Delete logging into vessl.audit_log.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 150r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit. No app code depends on it.
--
-- WHY. A freight quote can be deleted with no record in the database -- three
-- were on 3 Nov, found only in the API edge logs, which keep about a week and
-- hold the row id alone. order_history covers purchase orders, sales orders and
-- shipments, and vessl.audit_log has never had a writer (0 rows).
--
-- WHAT IT DOES.
--   1. audit_log gains one column, actor_email text. The rest already fits --
--      table_name, row_id, action (delete), actor_id, occurred_at (the time of
--      the delete, default now), old_data (the whole row, to_jsonb of OLD).
--      new_data stays unused by deletes. audit_log_actor_id_fkey goes --
--      actor_id referenced vessl.app_users, which is empty and never written,
--      so any signed-in actor was refused (23503) and the row was not logged.
--      actor_id now holds the auth user id, as order_history.actor_id does.
--   2. vessl.log_delete(), security definer, search_path vessl and pg_temp. One
--      audit_log row per deleted row. The actor is read as record_order_history
--      reads it -- sub and email from request.jwt.claims. Like that function, a
--      failure to log raises a warning and never blocks the delete. No execute
--      right for public, anon or authenticated (a trigger needs none).
--   3. AFTER DELETE FOR EACH ROW triggers trg_log_delete on shipment_quotes,
--      forwarder_bids and quotes. A row removed by a cascade (the bids and notes
--      of a deleted freight quote) fires its own trigger, so it is logged too,
--      with the same actor.
--   4. audit_log rights. Today any signed-in user may read, write and delete it
--      (audit_log_auth_all and staff_only, both FOR ALL). Those two policies go;
--      audit_log_staff_read lets staff select (vessl.is_staff); the restrictive
--      kui_staff_only stays. authenticated keeps select and loses every other
--      right, so only postgres (and the trigger, as postgres) writes it.
-- No row of any table changes.
--
-- GUARDS, before any change.
--   no vessl.log_delete; shipment_quotes and forwarder_bids have no trigger and
--   quotes only trg_quote_code, as measured on 5 Nov
--   audit_log has 0 rows, the eight columns, the three policies, the rights
--   and the one foreign key as measured on 5 Nov
--   no ZZ-150-PROBE row, and no quote coded Q-99999150 (the probe quote)
--
-- PROBES, each undone. Throwaway rows made as postgres, deleted as Matt
-- (role authenticated, his claims) -- as the app deletes.
--   pa a freight quote, a product quote and a bid, each deleted -- 3 log rows,
--      each with Matt as actor and the row in old_data
--   pb a freight quote with a bid, the quote deleted -- the cascade logs both
--   pc as Matt, audit_log can be read but not updated, deleted or written
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre150 on commit drop as
  select
    (select count(*) from pg_proc where proname = 'log_delete' and pronamespace = 'vessl'::regnamespace)    as n_fn,
    (select string_agg(c.relname || ' ' || t.tgname, ', ' order by c.relname, t.tgname)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.oid in ('vessl.shipment_quotes'::regclass, 'vessl.forwarder_bids'::regclass, 'vessl.quotes'::regclass)
        and not t.tgisinternal)                                                                           as h_trg,
    (select md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text from pg_trigger t
      where t.tgrelid = 'vessl.quotes'::regclass and t.tgname = 'trg_quote_code')                         as h_qcode,
    (select count(*) from vessl.audit_log)                                                                as n_audit,
    (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
       from information_schema.columns where table_schema = 'vessl' and table_name = 'audit_log')         as h_cols,
    (select string_agg(polname || ' ' || polpermissive::text || ' ' || polcmd::text, ', ' order by polname)
       from pg_policy where polrelid = 'vessl.audit_log'::regclass)                                       as h_pol,
    (select relacl::text from pg_class where oid = 'vessl.audit_log'::regclass)                           as h_acl,
    (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ', ' order by conname)
       from pg_constraint where conrelid = 'vessl.audit_log'::regclass and contype = 'f')                 as h_fk,
    (select count(*) from vessl.shipment_quotes where quote_number like 'ZZ-150-PROBE%')
      + (select count(*) from vessl.quotes where product like 'ZZ-150-PROBE%' or quote_code = 'Q-99999150')
      + (select count(*) from vessl.forwarder_bids where forwarder_name like 'ZZ-150-PROBE%')             as n_probe,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) from vessl.shipment_quotes q) as h_sq,
    (select md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.id), '')) from vessl.forwarder_bids b)  as h_bids,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) from vessl.quotes q)          as h_quotes,
    (select last_value::text || '/' || is_called::text from vessl.quote_code_seq)                          as h_seq;

do $guard$
begin
  if (select n_fn from _pre150) <> 0 then
    raise exception 'vessl.log_delete exists, nothing changed';
  end if;
  if (select h_trg from _pre150) is distinct from 'quotes trg_quote_code'
     or (select h_qcode from _pre150) is distinct from 'b7fd53764c316169a42bfd3d0ebfddae/O' then
    raise exception 'the triggers on shipment_quotes, forwarder_bids and quotes are not as measured, nothing changed';
  end if;
  if (select n_audit from _pre150) <> 0 then
    raise exception 'audit_log is not empty, nothing changed';
  end if;
  if (select h_cols from _pre150) is distinct from 'id uuid, table_name text, row_id uuid, action character varying, actor_id uuid, old_data jsonb, new_data jsonb, occurred_at timestamp with time zone'
     or (select h_pol from _pre150) is distinct from 'audit_log_auth_all true *, kui_staff_only false *, staff_only true *'
     or (select h_acl from _pre150) is distinct from '{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres}'
     or (select h_fk from _pre150) is distinct from 'audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES vessl.app_users(id) ON DELETE SET NULL' then
    raise exception 'audit_log columns, policies, rights or foreign key are not as measured, nothing changed';
  end if;
  if (select n_probe from _pre150) <> 0 then
    raise exception 'a ZZ-150-PROBE row exists, nothing changed';
  end if;
end
$guard$;

-- 1, the column, and actor_id freed from the empty app_users.
alter table vessl.audit_log add column actor_email text;
alter table vessl.audit_log drop constraint audit_log_actor_id_fkey;
comment on column vessl.audit_log.actor_id is 'Script 150. The auth user id (JWT sub) of whoever made the change, as order_history.actor_id. No foreign key.';
comment on column vessl.audit_log.actor_email is 'Script 150. The email in the JWT of whoever made the change, as order_history.actor_email.';

-- 2, the function.
create function vessl.log_delete()
returns trigger
language plpgsql
security definer
set search_path = vessl, pg_temp
as $fn$
declare
  r      jsonb := to_jsonb(old);
  claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    insert into vessl.audit_log (table_name, row_id, action, actor_id, actor_email, old_data, occurred_at)
    values (tg_table_name, (r->>'id')::uuid, 'delete',
            nullif(claims->>'sub', '')::uuid, nullif(claims->>'email', ''), r, now());
  exception when others then
    raise warning 'audit_log not recorded for % %, %', tg_table_name, coalesce(r->>'id', 'unknown'), sqlerrm;
  end;
  return null;
end
$fn$;

comment on function vessl.log_delete() is 'Script 150. AFTER DELETE trigger function on shipment_quotes, forwarder_bids and quotes. Writes one audit_log row per deleted row, cascades included -- action delete, the actor from the JWT claims, the whole row in old_data. A failure to log is a warning and never blocks the delete.';

revoke all on function vessl.log_delete() from public, anon, authenticated;

-- 3, the triggers.
create trigger trg_log_delete after delete on vessl.shipment_quotes for each row execute function vessl.log_delete();
create trigger trg_log_delete after delete on vessl.forwarder_bids for each row execute function vessl.log_delete();
create trigger trg_log_delete after delete on vessl.quotes for each row execute function vessl.log_delete();

-- 4, audit_log rights.
drop policy audit_log_auth_all on vessl.audit_log;
drop policy staff_only on vessl.audit_log;
create policy audit_log_staff_read on vessl.audit_log for select to authenticated using (vessl.is_staff());
revoke all on vessl.audit_log from authenticated;
grant select on vessl.audit_log to authenticated;
comment on table vessl.audit_log is 'Script 150. Delete log for shipment_quotes, forwarder_bids and quotes, written by vessl.log_delete(). Staff may read it; only postgres writes, updates or deletes it.';

create temp table _probe150 (step int, result text) on commit drop;

do $probe$
declare
  a   uuid;
  b   uuid;
  c   uuid;
  st  text;
  msg text;
  got text;
begin
  -- Matt, as the app signs him in. Set as postgres; set role below.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'cd479d49-0662-48f4-9958-f649b7fd8638', 'email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- pa, one of each.
  begin
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-150-PROBE-A', 'draft') returning id into a;
    -- The quote code trigger is held off for this one row, so no Q- number is
    -- spent; the code given fits quotes_quote_code_shape (Q- and 4 or more digits).
    alter table vessl.quotes disable trigger trg_quote_code;
    insert into vessl.quotes (quote_code, product) values ('Q-99999150', 'ZZ-150-PROBE') returning id into b;
    alter table vessl.quotes enable trigger trg_quote_code;
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-150-PROBE-B', 'draft') returning id into c;
    insert into vessl.forwarder_bids (shipment_quote_id, quote_number, forwarder_name) values (c, 'ZZ-150-PROBE-B', 'ZZ-150-PROBE-BID')
      returning id into c;
    set local role authenticated;
    delete from vessl.shipment_quotes where id = a;
    delete from vessl.quotes where id = b;
    delete from vessl.forwarder_bids where id = c;
    reset role;
    select count(*)::text || ' rows, ' || string_agg(l.table_name || ' ' || l.action || ' ' || coalesce(l.actor_email, 'none')
             || ' ' || coalesce(l.old_data->>'quote_number', l.old_data->>'quote_code', '') || coalesce(' ' || (l.old_data->>'forwarder_name'), ''),
             ', ' order by l.table_name)
           || ' / actor_id ' || count(*) filter (where l.actor_id = 'cd479d49-0662-48f4-9958-f649b7fd8638'::uuid)::text
      into msg from vessl.audit_log l where l.row_id in (a, b, c);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe150 values (1, case when st = 'P0001' then msg else st end);
  end;

  -- pb, a freight quote with a bid, the quote deleted.
  begin
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-150-PROBE-C', 'draft') returning id into a;
    insert into vessl.forwarder_bids (shipment_quote_id, quote_number, forwarder_name) values (a, 'ZZ-150-PROBE-C', 'ZZ-150-PROBE-CBID')
      returning id into b;
    set local role authenticated;
    delete from vessl.shipment_quotes where id = a;
    reset role;
    select count(*)::text || ' rows, ' || string_agg(l.table_name || ' ' || coalesce(l.actor_email, 'none')
             || coalesce(' ' || (l.old_data->>'forwarder_name'), ' ' || (l.old_data->>'quote_number')), ', ' order by l.table_name)
           || ' / bid still there ' || (select count(*) from vessl.forwarder_bids where id = b)::text
      into msg from vessl.audit_log l where l.row_id in (a, b);
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe150 values (2, case when st = 'P0001' then msg else st end);
  end;

  -- pc, what Matt may do to audit_log.
  begin
    insert into vessl.shipment_quotes (quote_number, status) values ('ZZ-150-PROBE-D', 'draft') returning id into a;
    delete from vessl.shipment_quotes where id = a;
    set local role authenticated;
    msg := 'select ' || (select count(*) from vessl.audit_log where row_id = a)::text;
    begin
      update vessl.audit_log set action = 'zz' where row_id = a;
      got := 'allowed';
    exception when others then
      get stacked diagnostics got = returned_sqlstate;
    end;
    msg := msg || ' update ' || got;
    begin
      delete from vessl.audit_log where row_id = a;
      got := 'allowed';
    exception when others then
      get stacked diagnostics got = returned_sqlstate;
    end;
    msg := msg || ' delete ' || got;
    begin
      insert into vessl.audit_log (table_name, action) values ('zz', 'zz');
      got := 'allowed';
    exception when others then
      get stacked diagnostics got = returned_sqlstate;
    end;
    msg := msg || ' insert ' || got;
    reset role;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe150 values (3, case when st = 'P0001' then msg else st end);
  end;

  perform set_config('request.jwt.claims', '', true);
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, triggers = ' || (select h_trg from _pre150) || ', audit_log rows ' || (select n_audit from _pre150)::text as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 log_delete -- security definer, search_path, no execute for anon or authenticated, comment',
         (select p.prosecdef::text || '/' || coalesce(p.proconfig::text, 'none')
                 || '/' || has_function_privilege('anon', p.oid, 'execute')::text
                 || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
                 || '/' || left(obj_description(p.oid, 'pg_proc'), 11)
            from pg_proc p where p.oid = 'vessl.log_delete()'::regprocedure),
         'true/{"search_path=vessl, pg_temp"}/false/false/Script 150.'::text
  union all
  select 'b2 the three AFTER DELETE triggers',
         (select string_agg(pg_get_triggerdef(t.oid), ' | ' order by c.relname)
            from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'trg_log_delete'),
         ('CREATE TRIGGER trg_log_delete AFTER DELETE ON vessl.forwarder_bids FOR EACH ROW EXECUTE FUNCTION vessl.log_delete()'
          || ' | CREATE TRIGGER trg_log_delete AFTER DELETE ON vessl.quotes FOR EACH ROW EXECUTE FUNCTION vessl.log_delete()'
          || ' | CREATE TRIGGER trg_log_delete AFTER DELETE ON vessl.shipment_quotes FOR EACH ROW EXECUTE FUNCTION vessl.log_delete()')::text
  union all
  select 'b3 trg_quote_code as before and enabled, the quote code sequence untouched',
         (select md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text from pg_trigger t
           where t.tgrelid = 'vessl.quotes'::regclass and t.tgname = 'trg_quote_code')
         || ' ' || (select last_value::text || '/' || is_called::text from vessl.quote_code_seq),
         (select h_qcode || ' ' || h_seq from _pre150)
  union all
  select 'b4 audit_log -- actor_email added, staff read only, authenticated select only, no foreign key',
         (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'audit_log')
         || ' / ' || (select string_agg(polname || ' ' || polpermissive::text || ' ' || polcmd::text, ', ' order by polname)
                        from pg_policy where polrelid = 'vessl.audit_log'::regclass)
         || ' / ' || (select relacl::text from pg_class where oid = 'vessl.audit_log'::regclass)
         || ' / fk ' || (select count(*) from pg_constraint where conrelid = 'vessl.audit_log'::regclass and contype = 'f')::text,
         'id,table_name,row_id,action,actor_id,old_data,new_data,occurred_at,actor_email / audit_log_staff_read true r, kui_staff_only false * / {postgres=arwdDxtm/postgres,authenticated=r/postgres} / fk 0'::text
  union all
  select 'b5 probes -- one of each, the cascade, what staff may do to the log',
         (select string_agg(result, ' || ' order by step) from _probe150),
         ('3 rows, forwarder_bids delete mattdillon@kinguniversal.com ZZ-150-PROBE-B ZZ-150-PROBE-BID, quotes delete mattdillon@kinguniversal.com Q-99999150, shipment_quotes delete mattdillon@kinguniversal.com ZZ-150-PROBE-A / actor_id 3'
          || ' || 2 rows, forwarder_bids mattdillon@kinguniversal.com ZZ-150-PROBE-CBID, shipment_quotes mattdillon@kinguniversal.com ZZ-150-PROBE-C / bid still there 0'
          || ' || select 1 update 42501 delete 42501 insert 42501')::text
  union all
  select 'b6 no real row changed, audit_log empty, no probe row left',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) = (select h_sq from _pre150) then 'same' else 'changed' end from vessl.shipment_quotes q)
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.id), '')) = (select h_bids from _pre150) then 'same' else 'changed' end from vessl.forwarder_bids b)
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) = (select h_quotes from _pre150) then 'same' else 'changed' end from vessl.quotes q)
         || '/' || (select count(*) from vessl.audit_log)::text
         || '/' || ((select count(*) from vessl.shipment_quotes where quote_number like 'ZZ-150-PROBE%')
                    + (select count(*) from vessl.quotes where product like 'ZZ-150-PROBE%' or quote_code = 'Q-99999150')
                    + (select count(*) from vessl.forwarder_bids where forwarder_name like 'ZZ-150-PROBE%'))::text,
         'same/same/same/0/0'::text
  union all
  select 'z0 verification ran, log_delete body = '
         || coalesce((select md5(prosrc) || '/' || length(prosrc) from pg_proc where oid = to_regprocedure('vessl.log_delete()')), 'none'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
