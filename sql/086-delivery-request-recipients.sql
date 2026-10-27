-- 86 -- Per-client extra recipients for delivery-request emails, and emails on change.
--
-- WHAT IT DOES. Three steps, in one transaction. No company gets a value here --
-- BucketGolf is script 87.
--   1. Adds companies.delivery_request_recipients, a nullable text array. Null
--      means no extras, and every company is left null. A CHECK refuses an
--      empty array, a null element, any upper case, and any entry that is not
--      one at-sign between two runs of characters with no comma or space.
--   2. Replaces portal.notify_delivery_request with the live body as read from
--      the SQL editor on 29 Sep, changing only two things.
--        RECIPIENTS. The base list is built exactly as before -- the vault
--        secret delivery_request_recipients split on commas and trimmed, or
--        riley and kristy when the secret is missing or blank. The client
--        company extras are appended, every address is lower-cased, and
--        duplicates are removed. Still one http_post, one email, every
--        address in to.
--        WORDING. On an UPDATE the subject and heading read Delivery request
--        changed instead of Delivery date requested. On an INSERT the email is
--        byte for byte what it was.
--      Kept as it was -- SECURITY DEFINER, search_path portal then public, the
--      silent return when resend_api_key is missing, the sender, the escaping
--      through portal.html_escape, the footer line.
--      EVERY COLON in the body is written chr(58), and the em dash and the
--      middle dot are chr(8212) and chr(183), because the SQL editor this is
--      pasted into eats a single colon. The colon also carries the url, so a
--      slip there stops mail -- the live test after this script is what proves
--      the email still arrives.
--      THE COMPANY LOOKUP relies on SECURITY DEFINER. When a client files a
--      request the function runs as its owner, and companies carries a
--      restrictive kui_staff_only policy. An owner subject to RLS would read
--      no row and silently send without the extras, so the guard requires the
--      owner to be a superuser or to bypass RLS, and d4 asserts it after.
--   3. Recreates trg_notify_delivery_request as AFTER INSERT OR UPDATE OF
--      requested_date. Until now it was insert only, so a client changing a
--      request emailed nobody. The portal sends requested_date in every change,
--      so every client resubmit emails, including one that keeps the date and
--      changes the note or re-asks after KUI adjusted -- each of those resets
--      status to requested, so staff need to see it. Staff Confirm and Adjust
--      in the ERP never write requested_date, so they do not email.
--
-- NO GRANT OR POLICY CHANGE ON companies. The new column is covered by the
-- table grant like the others. Clients cannot read companies, and portal
-- views built with a star keep the column list they were created with, so
-- the extras are not exposed to the portal. c1 and c2 assert grants and
-- policies against snapshots taken before any DDL.
--
-- EVERY COMPANY IS UNTOUCHED, proven by hashing whole rows minus the new column
-- before and after (b3). The hash needs no column list, so it does not depend
-- on how many columns companies has today.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre86 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies'
             and column_name = 'delivery_request_recipients')                          as col_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies')                  as cols_before,
         (select md5(coalesce(string_agg((to_jsonb(c) - 'delivery_request_recipients')::text, '/' order by c.id), ''))
            from vessl.companies c)                                                     as hash_before,
         (select relacl::text from pg_class where oid = 'vessl.companies'::regclass)   as acl_before,
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'vessl.companies'::regclass)               as pols_before,
         -- tgtype bits -- 1 row, 2 before, 4 insert, 8 delete, 16 update.
         -- 5 is AFTER INSERT FOR EACH ROW.
         (select string_agg(t.tgtype::text || '/' || (t.tgqual is null)::text, ',')
            from pg_trigger t
           where t.tgrelid = 'portal.delivery_requests'::regclass
             and t.tgname = 'trg_notify_delivery_request')                              as trg_before,
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
            from pg_proc p where p.oid = 'portal.notify_delivery_request'::regproc)    as fn_flags_before,
         (select (r.rolsuper or r.rolbypassrls)
            from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid = 'portal.notify_delivery_request'::regproc)                    as owner_skips_rls;

do $guard$
begin
  if (select col_before from _pre86) <> 0 then
    raise exception 'companies already has delivery_request_recipients, nothing changed';
  end if;
  if (select trg_before from _pre86) is distinct from '5/true' then
    raise exception 'trg_notify_delivery_request is not a plain AFTER INSERT row trigger, nothing changed';
  end if;
  if (select fn_flags_before from _pre86) not like 'true/%' then
    raise exception 'notify_delivery_request is not SECURITY DEFINER, nothing changed';
  end if;
  if (select owner_skips_rls from _pre86) is not true then
    raise exception 'the function owner is subject to RLS on companies and would never see the extras, nothing changed';
  end if;
end
$guard$;

alter table vessl.companies
  add column delivery_request_recipients text[];

alter table vessl.companies
  add constraint companies_delivery_request_recipients_shape
  check (delivery_request_recipients is null
         or (cardinality(delivery_request_recipients) > 0
             and array_position(delivery_request_recipients, null) is null
             and array_to_string(delivery_request_recipients, ',')
                 = lower(array_to_string(delivery_request_recipients, ','))
             and array_to_string(delivery_request_recipients, ',')
                 ~ '^[^,@ ]+@[^,@ ]+(,[^,@ ]+@[^,@ ]+)*$'));

comment on column vessl.companies.delivery_request_recipients is
  'For a client -- extra addresses emailed when this client files or changes a delivery request, on top of the vault secret delivery_request_recipients that every client uses. Lower case. Null means no extras.';

-- The live body with two changes, marked NEW. Everything else is as read.
-- create or replace keeps the owner and the grants, and restates SECURITY
-- DEFINER and the search_path, which d3 compares against the snapshot.
create or replace function portal.notify_delivery_request()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'portal', 'public'
as $function$
declare
  k text;
  recips text;
  base text[];
  extras text[];
  to_list text[];
  heading text;
  colon constant text := chr(58);
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key';
  if k is null then return new; end if;

  select decrypted_secret into recips from vault.decrypted_secrets
   where name = 'delivery_request_recipients';
  base := coalesce(
    nullif(array(select btrim(x) from unnest(string_to_array(coalesce(recips,''), ',')) as x
                  where btrim(x) <> ''), '{}'),
    array['riley@kinguniversal.com','kristy@kinguniversal.com']);

  -- NEW. This client company extras, merged in, lower-cased, duplicates removed.
  select co.delivery_request_recipients into extras
    from vessl.companies co where co.id = new.client_company_id;
  to_list := array(select distinct lower(x)
                     from unnest(base || coalesce(extras, '{}'::text[])) as x
                    order by 1);

  -- NEW. A change to an existing request says so.
  heading := case when tg_op = 'UPDATE' then 'Delivery request changed'
                  else 'Delivery date requested' end;

  perform net.http_post(
    url := 'https' || colon || '//api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||k,'Content-Type','application/json'),
    body := jsonb_build_object(
      'from','VESSL <notify@vessl.io>',
      'to', to_jsonb(to_list),
      'subject',heading||' '||chr(8212)||' '||new.shipment_ref,
      'html','<div style="font-family'||colon||'sans-serif;max-width'||colon||'520px"><h2 style="margin'||colon||'0 0 8px">'
        ||heading||'</h2><p style="color'||colon||'#555;line-height'||colon||'1.6"><b>'
        ||portal.html_escape(new.shipment_ref)||'</b>'
        ||case when new.container_no is not null then ' '||chr(183)||' container '||portal.html_escape(new.container_no) else '' end
        ||'<br/>Requested date'||colon||' <b>'||to_char(new.requested_date,'Mon DD, YYYY')||'</b>'
        ||case when new.eta is not null then '<br/>ETA'||colon||' '||to_char(new.eta,'Mon DD, YYYY') else '' end
        ||'<br/>By'||colon||' '||portal.html_escape(coalesce(new.requested_by,'portal user'))
        ||case when new.note is not null then '<br/>Note'||colon||' '||portal.html_escape(new.note) else '' end
        ||'</p><p style="color'||colon||'#999;font-size'||colon||'12px">Reply to the client in the portal, then set the request to confirmed / adjusted / declined.</p></div>'
    ));
  return new;
end $function$;

drop trigger trg_notify_delivery_request on portal.delivery_requests;

create trigger trg_notify_delivery_request
  after insert or update of requested_date on portal.delivery_requests
  for each row execute function portal.notify_delivery_request();

-- PROBES against the CHECK. Five inserts, each in its own subtransaction.
-- Four are refused -- empty, upper case, no at-sign, a null element. The
-- fifth is accepted and then undone by raising accepted. None survives.
create temp table _probe86 (n int, result text) on commit drop;

do $probe$
declare
  vals text[] := array['{}', '{<contact>}', '{no-at-sign}',
                       '{<contact>,NULL}', '{<contact>}'];
  r text;
begin
  for i in 1 .. 5 loop
    begin
      insert into vessl.companies (name, type, delivery_request_recipients)
      values ('ZZ probe client ' || i, 'client', vals[i]::text[]);
      raise exception 'accepted';
    exception
      when check_violation then r := 'refused';
      when others          then r := sqlerrm;
    end;
    insert into _probe86 values (i, r);
  end loop;
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 column did not exist and the trigger was AFTER INSERT only' as chk,
         (select col_before::text || '/' || trg_before from _pre86) as got, '0/5/true' as want
  union all
  select 'b1 column exists, text array, nullable, no default',
         (select data_type || '/' || udt_name || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies'
             and column_name = 'delivery_request_recipients'),
         'ARRAY/_text/YES/none'
  union all
  select 'b2 exactly one column added',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'companies') - cols_before)::text
            from _pre86), '1'
  union all
  select 'b3 every company is unchanged and none has recipients',
         (select md5(coalesce(string_agg((to_jsonb(c) - 'delivery_request_recipients')::text, '/' order by c.id), ''))
                 || '/' || count(c.delivery_request_recipients)::text
            from vessl.companies c),
         (select hash_before || '/0' from _pre86)
  union all
  select 'b4 probes -- empty, upper case, no at-sign, null element, valid',
         (select string_agg(result, '/' order by n) from _probe86),
         'refused/refused/refused/refused/accepted'
  union all
  select 'c1 the grant on companies is unchanged, and no column carries its own',
         (select relacl::text from pg_class where oid = 'vessl.companies'::regclass) || '/' ||
         (select count(*)::text from pg_attribute where attrelid = 'vessl.companies'::regclass and attacl is not null),
         (select acl_before || '/0' from _pre86)
  union all
  select 'c2 the policies on companies are unchanged',
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'vessl.companies'::regclass),
         (select pols_before from _pre86)
  union all
  select 'c3 authenticated may read and write the column, as the ERP edit form will',
         (select has_column_privilege('authenticated', 'vessl.companies', 'delivery_request_recipients', 'SELECT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.companies', 'delivery_request_recipients', 'UPDATE')::text),
         'true/true'
  union all
  -- 21 is AFTER INSERT OR UPDATE FOR EACH ROW -- 1 + 4 + 16.
  select 'd1 trigger is AFTER INSERT OR UPDATE OF requested_date, enabled, no WHEN, calls the function',
         (select t.tgtype::text || '/' || a.attname || '/' || t.tgenabled::text || '/'
                 || (t.tgqual is null)::text || '/' || t.tgfoid::regproc::text
            from pg_trigger t
            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = t.tgattr[0]
           where t.tgrelid = 'portal.delivery_requests'::regclass
             and t.tgname = 'trg_notify_delivery_request'
             and t.tgattr[1] is null),
         '21/requested_date/O/true/portal.notify_delivery_request'
  union all
  select 'd2 exactly one trigger on delivery_requests calls the function',
         (select count(*)::text from pg_trigger
           where tgrelid = 'portal.delivery_requests'::regclass
             and tgfoid = 'portal.notify_delivery_request'::regproc), '1'
  union all
  select 'd3 the function keeps its security definer flag, search_path, owner and grants',
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
            from pg_proc p where p.oid = 'portal.notify_delivery_request'::regproc),
         (select fn_flags_before from _pre86)
  union all
  select 'd4 the function owner still reads companies past RLS',
         (select (r.rolsuper or r.rolbypassrls)::text
            from pg_proc p join pg_roles r on r.oid = p.proowner
           where p.oid = 'portal.notify_delivery_request'::regproc), 'true'
  union all
  select 'd5 the new body reads the company extras and branches on the operation',
         (select (position('co.delivery_request_recipients' in p.prosrc) > 0)::text || '/'
                 || (position('tg_op' in p.prosrc) > 0)::text
            from pg_proc p where p.oid = 'portal.notify_delivery_request'::regproc), 'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
