-- 91 -- Approve the non-KUI ZZ test login and bind it to ZZDELIV.
--
-- WHY. portal.is_kui_staff() is the email domain alone, so every
-- kinguniversal.com login -- plus-addressed ones included -- takes the staff
-- path through RLS. An honest client-side test of script 90 needs a login
-- outside that domain. <test login> signed up at the
-- portal on 30 Sep, company ZZDELIV, and is pending.
--
-- WHAT IT DOES. One update on portal.users, the same shape as the approval in
-- script 88 -- status approved, company_id the ZZDELIV client. Nothing else.
--
-- GUARDS, all before the write.
--   exactly one portal.users row for the address, compared lower-cased, with
--   the stored address length 33 -- still pending, no company yet
--   it is tied to a real auth user
--   the address is NOT in the kinguniversal.com domain, which is the point
--   exactly one client company named ZZDELIV
--
-- b3 reports whether the auth email is confirmed. It is a check, not a guard.
-- Approval is harmless without it, but the login cannot sign in until the
-- Supabase confirmation link has been clicked, so a b3 row means do that
-- before testing.

begin;

create temp table _pre91 on commit drop as
  select (select count(*) from portal.users
           where lower(email) = '<test login>')                   as rows_for_address,
         (select count(*) from portal.users
           where lower(email) = '<test login>'
             and length(email) = 33
             and status::text = 'pending' and company_id is null)                        as pending_unbound,
         (select count(*) from portal.users u join auth.users a on a.id = u.auth_user_id
           where lower(u.email) = '<test login>')                  as with_auth_user,
         (select coalesce(bool_or(portal_email_is_staff), false) from (
            select email ilike '%@kinguniversal.com' as portal_email_is_staff from portal.users
             where lower(email) = '<test login>') s)                as is_staff_domain,
         (select count(*) from vessl.companies
           where name = 'ZZDELIV' and type::text = 'client')                             as zz_clients,
         (select count(*) from portal.users where status::text = 'approved')             as approved_before,
         (select md5(coalesce(string_agg(to_jsonb(u)::text, '/' order by u.auth_user_id::text), ''))
            from portal.users u
           where lower(u.email) <> '<test login>')                  as others_before;

do $guard$
begin
  if (select rows_for_address from _pre91) <> 1 or (select pending_unbound from _pre91) <> 1 then
    raise exception 'expected exactly one pending row with no company for the zzclient address, nothing changed';
  end if;
  if (select with_auth_user from _pre91) <> 1 then
    raise exception 'the zzclient row is not tied to an auth user, nothing changed';
  end if;
  if (select is_staff_domain from _pre91) then
    raise exception 'the address is in the kinguniversal.com domain and would test the staff path, nothing changed';
  end if;
  if (select zz_clients from _pre91) <> 1 then
    raise exception 'expected exactly one client company named ZZDELIV, nothing changed';
  end if;
end
$guard$;

update portal.users u
   set status = 'approved',
       company_id = (select c.id from vessl.companies c where c.name = 'ZZDELIV' and c.type::text = 'client')
 where lower(u.email) = '<test login>'
   and u.status::text = 'pending' and u.company_id is null;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 one pending unbound row, tied to an auth user, outside the staff domain, one ZZDELIV' as chk,
         (select rows_for_address::text || '/' || pending_unbound::text || '/' || with_auth_user::text
                 || '/' || is_staff_domain::text || '/' || zz_clients::text from _pre91) as got,
         '1/1/1/false/1' as want
  union all
  select 'b1 the login is approved and bound to ZZDELIV',
         (select u.status::text || '/' || (u.company_id = c.id)::text
            from portal.users u, vessl.companies c
           where lower(u.email) = '<test login>'
             and c.name = 'ZZDELIV' and c.type::text = 'client'), 'approved/true'
  union all
  select 'b2 exactly one more approved portal user than before',
         (select ((select count(*) from portal.users where status::text = 'approved') - approved_before)::text
            from _pre91), '1'
  union all
  select 'b3 the auth email is confirmed -- if not, click the Supabase link before testing',
         (select (a.email_confirmed_at is not null)::text
            from portal.users u join auth.users a on a.id = u.auth_user_id
           where lower(u.email) = '<test login>'), 'true'
  union all
  select 'b4 no other portal user changed',
         (select md5(coalesce(string_agg(to_jsonb(u)::text, '/' order by u.auth_user_id::text), ''))
            from portal.users u
           where lower(u.email) <> '<test login>'),
         (select others_before from _pre91)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
