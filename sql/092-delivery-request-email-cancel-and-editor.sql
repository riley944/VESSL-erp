-- 92 -- Delivery-request emails -- no Gmail threading, a cancel email, and requested_by follows the editor.
--
-- WHAT IT DOES. Three changes, in one transaction.
--   1. portal.notify_delivery_request, the script 86 body with these changes.
--        SUBJECT carries the requested date --
--          Delivery date requested / changed / cancelled, em dash, the ref,
--          middle dot, the date as Mon and day, for example Oct 17.
--        X-ENTITY-REF-ID. Every email carries this header with a fresh uuid,
--        in the headers object of the Resend body. Resend documents it as the
--        way to prevent Gmail threading. Message-ID is NOT set -- Resend
--        already gives every email its own, and its docs describe no override,
--        so setting one risks a rejected send for no gain.
--        CANCELLED. On an update to cancelled the heading, subject and footer
--        say so, and the By line reads Cancelled by with the email of the
--        login that cancelled, from the JWT, falling back to requested_by.
--        Recipients are built exactly as in 86 -- vault list plus client
--        extras, lower-cased, duplicates removed, one email.
--      Everything else is as 86 left it -- SECURITY DEFINER, search_path,
--      the silent return without resend_api_key, sender, escaping, chr(58)
--      for every colon.
--   2. A second trigger, trg_notify_delivery_request_cancelled, AFTER UPDATE OF
--      status, WHEN the new status is cancelled and the old one was not. It
--      calls the same function. The script 86 trigger is left exactly as it is,
--      so a date change still emails as changed and a staff Confirm, Adjust or
--      Decline -- which writes status but not requested_date, and never
--      cancelled -- still sends nothing.
--      cancel_delivery_request runs update ... set status = cancelled, so it
--      fires this trigger. a1 lists every other function whose body mentions
--      both delivery_requests and cancelled -- it must be that one alone. In
--      the ERP, respond() writes only confirmed, adjusted and declined, and the
--      portal cancels only through the function.
--   3. portal.dr_client_update_guard from script 90 now also lets a client
--      change requested_by -- but only to the email of their own login, so a
--      change records who made it and cannot name somebody else.
--
-- PROBES, as the non-KUI ZZDELIV login, each undone inside its own block. They
-- fire the new body for real, so a runtime error in it shows here instead of
-- in the portal. The emails they queue are undone with them -- nothing is sent.
--   q1 change date, note and requested_by to own email -- rows 1
--   q2 set requested_by to another address -- refused
--   q3 cancel_delivery_request on the same row -- got cancelled
-- They need a ZZDELIV request that is still requested. Without one they report
-- skipped and the structural checks still run.

begin;

create temp table _pre92 on commit drop as
  select (select tgtype::text from pg_trigger where tgrelid = 'portal.delivery_requests'::regclass
                                                and tgname = 'trg_notify_delivery_request')        as notify_trg,
         (select tgtype::text from pg_trigger where tgrelid = 'portal.delivery_requests'::regclass
                                                and tgname = 'trg_dr_client_update_guard')         as guard_trg,
         (select count(*) from pg_policy where polrelid = 'portal.delivery_requests'::regclass
                                           and polname = 'dr_client_update')                       as client_pol,
         (select count(*) from pg_trigger where tgrelid = 'portal.delivery_requests'::regclass
                                            and tgname = 'trg_notify_delivery_request_cancelled')  as cancel_trg_before,
         (select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by p.proname), 'none')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prosrc ilike '%delivery_requests%' and p.prosrc ilike '%cancelled%'
             and p.proname <> 'notify_delivery_request')                                            as cancel_writers,
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
            from pg_proc p where p.oid = 'portal.notify_delivery_request'::regproc)               as notify_flags,
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
            from pg_proc p where p.oid = 'portal.dr_client_update_guard'::regproc)                as guard_flags,
         (select md5(coalesce(string_agg(to_jsonb(d)::text, '/' order by d.id), ''))
            from portal.delivery_requests d)                                                        as rows_before;

do $guard$
begin
  if (select notify_trg from _pre92) is distinct from '21'
     or (select guard_trg from _pre92) is distinct from '19'
     or (select client_pol from _pre92) <> 1 then
    raise exception 'scripts 86 and 90 are not both live, nothing changed';
  end if;
  if (select cancel_trg_before from _pre92) <> 0 then
    raise exception 'the cancel trigger already exists, nothing changed';
  end if;
end
$guard$;

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
  by_label text;
  by_who text;
  footer text;
  cancelled boolean;
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

  -- This client company extras, merged in, lower-cased, duplicates removed.
  select co.delivery_request_recipients into extras
    from vessl.companies co where co.id = new.client_company_id;
  to_list := array(select distinct lower(x)
                     from unnest(base || coalesce(extras, '{}'::text[])) as x
                    order by 1);

  -- What happened. The cancel trigger fires only on a move to cancelled.
  cancelled := tg_op = 'UPDATE' and new.status::text = 'cancelled';
  heading := case when tg_op = 'INSERT' then 'Delivery date requested'
                  when cancelled then 'Delivery request cancelled'
                  else 'Delivery request changed' end;
  by_label := case when cancelled then 'Cancelled by' else 'By' end;
  by_who := case when cancelled
                 then coalesce(nullif(auth.jwt() ->> 'email', ''), new.requested_by, 'portal user')
                 else coalesce(new.requested_by, 'portal user') end;
  footer := case when cancelled
                 then 'The client cancelled this request. There is nothing to confirm.'
                 else 'Reply to the client in the portal, then set the request to confirmed / adjusted / declined.' end;

  perform net.http_post(
    url := 'https' || colon || '//api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer '||k,'Content-Type','application/json'),
    body := jsonb_build_object(
      'from','VESSL <notify@vessl.io>',
      'to', to_jsonb(to_list),
      'subject',heading||' '||chr(8212)||' '||new.shipment_ref||' '||chr(183)||' '||to_char(new.requested_date,'Mon FMDD'),
      -- A fresh id on every email, so Gmail never threads two of them together.
      'headers', jsonb_build_object('X-Entity-Ref-ID', gen_random_uuid()::text),
      'html','<div style="font-family'||colon||'sans-serif;max-width'||colon||'520px"><h2 style="margin'||colon||'0 0 8px">'
        ||heading||'</h2><p style="color'||colon||'#555;line-height'||colon||'1.6"><b>'
        ||portal.html_escape(new.shipment_ref)||'</b>'
        ||case when new.container_no is not null then ' '||chr(183)||' container '||portal.html_escape(new.container_no) else '' end
        ||'<br/>Requested date'||colon||' <b>'||to_char(new.requested_date,'Mon DD, YYYY')||'</b>'
        ||case when new.eta is not null then '<br/>ETA'||colon||' '||to_char(new.eta,'Mon DD, YYYY') else '' end
        ||'<br/>'||by_label||colon||' '||portal.html_escape(by_who)
        ||case when new.note is not null then '<br/>Note'||colon||' '||portal.html_escape(new.note) else '' end
        ||'</p><p style="color'||colon||'#999;font-size'||colon||'12px">'||footer||'</p></div>'
    ));
  return new;
end $function$;

create trigger trg_notify_delivery_request_cancelled
  after update of status on portal.delivery_requests
  for each row
  when (new.status::text = 'cancelled' and old.status::text is distinct from 'cancelled')
  execute function portal.notify_delivery_request();

create or replace function portal.dr_client_update_guard()
 returns trigger
 language plpgsql
 set search_path to 'portal', 'public'
as $function$
begin
  -- Staff, and anything that is not a portal role, are not limited here.
  if current_user not in ('authenticated', 'anon') or portal.is_kui_staff() then
    return new;
  end if;
  if (to_jsonb(new) - array['requested_date', 'note', 'status', 'requested_by'])
     is distinct from (to_jsonb(old) - array['requested_date', 'note', 'status', 'requested_by']) then
    raise exception 'A delivery request can only have its date and note changed from the portal.'
      using errcode = 'check_violation';
  end if;
  if new.status::text is distinct from 'requested' then
    raise exception 'A changed delivery request goes back to KUI as requested.'
      using errcode = 'check_violation';
  end if;
  -- requested_by follows the editor, and can only ever name the editor.
  if new.requested_by is distinct from old.requested_by
     and lower(coalesce(new.requested_by, '')) is distinct from lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'requested_by can only be set to your own email.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

-- PROBE SETUP, as postgres. The non-KUI ZZDELIV login, with its auth email as
-- the JWT email, and its newest request that is still requested.
select set_config('zz92.uid', coalesce((
         select u.auth_user_id::text from portal.users u
           join vessl.companies c on c.id = u.company_id
          where c.name = 'ZZDELIV' and c.type::text = 'client' and u.status::text = 'approved'
            and u.email not ilike '%@kinguniversal.com'
          order by u.email limit 1), ''), true),
       set_config('zz92.req', coalesce((
         select d.id::text from portal.delivery_requests d
           join vessl.companies c on c.id = d.client_company_id
          where c.name = 'ZZDELIV' and d.status::text = 'requested'
          order by d.created_at desc limit 1), ''), true);

select set_config('zz92.email', coalesce((
         select a.email from auth.users a
          where a.id::text = current_setting('zz92.uid')), ''), true);

select set_config('request.jwt.claims',
         case when current_setting('zz92.uid') = '' then ''
              else json_build_object('sub', current_setting('zz92.uid'),
                                     'email', current_setting('zz92.email'),
                                     'role', 'authenticated')::text end, true),
       set_config('request.jwt.claim.sub', current_setting('zz92.uid'), true);

set local role authenticated;

do $probe$
declare
  r text;
  n int;
  res text;
  rec portal.delivery_requests;
begin
  if current_setting('zz92.uid') = '' or current_setting('zz92.req') = '' then
    perform set_config('zz92.result', 'skipped', true);
    return;
  end if;

  begin
    update portal.delivery_requests
       set requested_date = requested_date + 1, note = 'zz 92 probe', status = 'requested',
           requested_by = current_setting('zz92.email')
     where id = current_setting('zz92.req')::uuid;
    get diagnostics n = row_count;
    raise exception 'rows %', n;
  exception
    when check_violation or insufficient_privilege then r := 'refused';
    when others then r := sqlerrm;
  end;
  res := r;

  begin
    update portal.delivery_requests set requested_by = '<contact>'
     where id = current_setting('zz92.req')::uuid;
    get diagnostics n = row_count;
    raise exception 'rows %', n;
  exception
    when check_violation or insufficient_privilege then r := 'refused';
    when others then r := sqlerrm;
  end;
  res := res || '/' || r;

  begin
    rec := portal.cancel_delivery_request(current_setting('zz92.req')::uuid);
    raise exception 'got %', rec.status;
  exception
    when others then r := sqlerrm;
  end;
  res := res || '/' || r;

  perform set_config('zz92.result', res, true);
end
$probe$;

reset role;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 86 notify trigger, 90 guard trigger and policy live, no cancel trigger yet' as chk,
         (select notify_trg || '/' || guard_trg || '/' || client_pol::text || '/' || cancel_trg_before::text
            from _pre92) as got,
         '21/19/1/0' as want
  union all
  select 'a1 the only function that writes cancelled to delivery_requests is the cancel RPC',
         (select cancel_writers from _pre92)::text, 'portal.cancel_delivery_request'
  union all
  select 'b1 notify keeps its security definer flag, search_path, owner and grants',
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
            from pg_proc p where p.oid = 'portal.notify_delivery_request'::regproc),
         (select notify_flags from _pre92)
  union all
  select 'b2 notify body has the header, the cancelled branch, the dated subject and the extras',
         (select (position('X-Entity-Ref-ID' in prosrc) > 0)::text || '/'
                 || (position('Delivery request cancelled' in prosrc) > 0)::text || '/'
                 || (position('Mon FMDD' in prosrc) > 0)::text || '/'
                 || (position('co.delivery_request_recipients' in prosrc) > 0)::text
            from pg_proc where oid = 'portal.notify_delivery_request'::regproc), 'true/true/true/true'
  union all
  select 'b3 the 86 trigger is unchanged -- AFTER INSERT OR UPDATE OF requested_date',
         (select t.tgtype::text || '/' || a.attname || '/' || (t.tgqual is null)::text
            from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = t.tgattr[0]
           where t.tgrelid = 'portal.delivery_requests'::regclass
             and t.tgname = 'trg_notify_delivery_request' and t.tgattr[1] is null),
         '21/requested_date/true'
  union all
  -- 17 is AFTER UPDATE FOR EACH ROW -- 1 + 16.
  select 'b4 the cancel trigger is AFTER UPDATE OF status, with a WHEN, enabled, calling notify',
         (select t.tgtype::text || '/' || a.attname || '/' || (t.tgqual is not null)::text || '/'
                 || t.tgenabled::text || '/' || t.tgfoid::regproc::text
            from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = t.tgattr[0]
           where t.tgrelid = 'portal.delivery_requests'::regclass
             and t.tgname = 'trg_notify_delivery_request_cancelled' and t.tgattr[1] is null),
         '17/status/true/O/portal.notify_delivery_request'
  union all
  select 'c1 the guard keeps its flags -- still SECURITY INVOKER -- and now allows requested_by',
         (select p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), 'none')
                 || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(p.proacl::text, 'default')
                 || '/' || (position('requested_by' in p.prosrc) > 0)::text
            from pg_proc p where p.oid = 'portal.dr_client_update_guard'::regproc),
         (select guard_flags || '/true' from _pre92)
  union all
  select 'c2 the guard function is not security definer',
         (select prosecdef::text from pg_proc where oid = 'portal.dr_client_update_guard'::regproc), 'false'
  union all
  select 'd1 no delivery request was changed by the probes',
         (select md5(coalesce(string_agg(to_jsonb(d)::text, '/' order by d.id), ''))
            from portal.delivery_requests d),
         (select rows_before from _pre92)
  union all
  select 'p1 probes as the non-KUI ZZDELIV login -- change with own email, other email, cancel',
         current_setting('zz92.result', true)::text,
         case when current_setting('zz92.uid', true) = '' or current_setting('zz92.req', true) = '' then 'skipped'
              else 'rows 1/refused/got cancelled' end
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
