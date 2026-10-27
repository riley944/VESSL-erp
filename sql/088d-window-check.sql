-- 88d -- After 88c. Did any real client file or change a request while the vault was on mattdillon?
--
-- Writes nothing. Run it straight after 88c commits.
--
-- THE WINDOW. The last three hours, which covers 88b to 88c with room to
-- spare -- a request from before 88b in that span is a false alarm, never a
-- miss. Compare each row created time against the r0 times 88b and 88c
-- printed. A row inside the window reached mattdillon alone. Forward it to
-- riley and kristy, plus the client extras if 87 has run.
--
-- CHANGES COUNT TOO. Since 86 a client changing a request emails as well. If
-- delivery_requests has an updated_at column it is used, read through to_jsonb
-- so this script still parses if the column does not exist. Without it, a
-- change to an older request cannot be seen here, and w1 says so.
--
-- WHAT EACH ROW MEANS
--   w0 -- non-ZZ requests in the window. Shows only if there are any.
--   w1 -- whether changes are visible. Shows only if they are not.
--   w2 -- the vault is back on riley and kristy. Shows only if it is not.
--   r1 -- the ZZ requests, always shown.
--   r2 -- the last Resend responses pg_net recorded, always shown. A 200 means
--         Resend took the email. The Resend dashboard is still what proves
--         who received it.

begin;

create temp table _resp88d (line text) on commit drop;

do $resp$
begin
  if to_regclass('net._http_response') is null then
    insert into _resp88d values ('net._http_response not found');
  else
    execute 'insert into _resp88d select coalesce(string_agg(status_code::text || case when timed_out then '' timed out'' else '''' end, '', '' order by created desc), ''none'')'
         || ' from (select * from net._http_response where created > now() - interval ''3 hours'' order by created desc limit 10) x';
  end if;
end
$resp$;

select * from (
  select 'w0 non-ZZ requests filed or changed in the last three hours' as chk,
         (select count(*)::text || ' ' || coalesce(string_agg(
                   coalesce(c.name, 'no company') || ' ' || d.shipment_ref || ' created '
                   || d.created_at::text, ' | ' order by d.created_at), 'none')
            from portal.delivery_requests d
            left join vessl.companies c on c.id = d.client_company_id
           where coalesce(c.name, '') not like 'ZZDELIV%'
             and greatest(d.created_at, coalesce((to_jsonb(d) ->> 'updated_at')::timestamptz, d.created_at))
                 > now() - interval '3 hours') as got,
         '0 none' as want
  union all
  select 'w1 delivery_requests has updated_at, so changes are visible',
         (select (count(*) = 1)::text from information_schema.columns
           where table_schema = 'portal' and table_name = 'delivery_requests'
             and column_name = 'updated_at'), 'true'
  union all
  select 'w2 the vault is back on riley and kristy, length 48',
         (select length(decrypted_secret)::text || '/'
                 || (decrypted_secret = 'riley@kinguniversal.com,kristy@kinguniversal.com')::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '48/true'
  union all
  select 'r1 ZZ requests',
         (select coalesce(string_agg(d.shipment_ref || ' ' || d.status::text || ' for '
                   || d.requested_date::text || ' created ' || d.created_at::text, ' | ' order by d.created_at), 'none')
            from portal.delivery_requests d
            join vessl.companies c on c.id = d.client_company_id
           where c.name = 'ZZDELIV'),
         'shown every run'
  union all
  select 'r2 last Resend responses, newest first', (select line::text from _resp88d), 'shown every run'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

rollback;
