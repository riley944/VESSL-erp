-- 90 -- Let a portal client change their own delivery request -- date and note only.
--
-- WHY. portal.delivery_requests has four policies -- dr_client_insert,
-- dr_client_read, dr_staff_read, dr_staff_update. There is NO client update
-- policy, so the portal Change delivery request path can only ever succeed for
-- a login that passes portal.is_kui_staff(), which is any email ending
-- at kinguniversal.com. A real client gets zero rows updated. The portal now
-- reports that as an error instead of a false success.
--
-- WHAT IT DOES. Three objects, in one transaction.
--   1. Policy dr_client_update, FOR UPDATE TO authenticated.
--        USING       own company, and status is requested, confirmed,
--                    adjusted or declined. A withdrawn request is history --
--                    asking again inserts a new row.
--        WITH CHECK  own company, and status is requested.
--   2. Function portal.dr_client_update_guard, a plain SECURITY INVOKER
--      trigger function. A policy cannot say which COLUMNS may change, and a
--      column grant cannot either here, because staff write through the same
--      authenticated role and need status, proposed_date, kui_response_note,
--      responded_at and responded_by. So the trigger compares the whole row
--      before and after, minus requested_date, note and status, and refuses
--      any other difference. It also refuses any status but requested.
--      It stands aside for staff, and for anything not running as a portal
--      role -- postgres in the SQL editor, service_role, and SECURITY DEFINER
--      functions such as cancel_delivery_request, which run as their owner.
--      That is why the function must NOT be security definer -- current_user
--      is what tells a portal client from everything else. d4 asserts it.
--   3. Trigger trg_dr_client_update_guard, BEFORE UPDATE FOR EACH ROW.
--
-- WHAT IT DOES NOT DO. KUI earlier answer stays on the row when a client
-- re-asks -- proposed_date, kui_response_note, responded_at, responded_by.
-- The portal hides it once status is back to requested. Clearing it would
-- lose who answered what, so that is a separate decision.
--
-- EMAIL. A client change writes requested_date, so the script 86 trigger
-- sends Delivery request changed, exactly as it already does for staff logins.
--
-- PROBES need a NON-KUI login bound to ZZDELIV. The kinguniversal plus-address
-- logins pass is_kui_staff and would test the staff path, not this one. If no
-- such login exists the probes report skipped and every structural check
-- still runs. With one, four probes run as that user, each undone inside its
-- own block -- a change of date and note (accepted, 1 row), a staff column
-- (refused), status confirmed (refused), and another company request
-- (0 rows, or skipped if none exists). The first probe fires the script 86
-- trigger, but its queued email is undone with the update, so nothing is sent.

begin;

create temp table _pre90 on commit drop as
  select (select count(*) from pg_policy
           where polrelid = 'portal.delivery_requests'::regclass)                      as pols_before,
         (select count(*) from pg_policy
           where polrelid = 'portal.delivery_requests'::regclass
             and polname = 'dr_client_update')                                           as new_pol_before,
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'portal.delivery_requests'::regclass)      as pols_text_before,
         (select count(*) from pg_trigger
           where tgrelid = 'portal.delivery_requests'::regclass
             and tgname = 'trg_dr_client_update_guard')                                 as trg_before,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'portal' and p.proname = 'dr_client_update_guard')          as fn_before,
         (select relacl::text from pg_class where oid = 'portal.delivery_requests'::regclass) as acl_before,
         (select md5(coalesce(string_agg(to_jsonb(d)::text, '/' order by d.id), ''))
            from portal.delivery_requests d)                                             as rows_before;

do $guard$
begin
  if (select pols_before from _pre90) <> 4 or (select new_pol_before from _pre90) <> 0 then
    raise exception 'expected the four existing policies and no dr_client_update, nothing changed';
  end if;
  if (select trg_before + fn_before from _pre90) <> 0 then
    raise exception 'the guard trigger or function already exists, nothing changed';
  end if;
end
$guard$;

create policy dr_client_update on portal.delivery_requests
  for update to authenticated
  using (client_company_id = portal.my_company_id()
         and status::text in ('requested', 'confirmed', 'adjusted', 'declined'))
  with check (client_company_id = portal.my_company_id()
              and status::text = 'requested');

create function portal.dr_client_update_guard()
 returns trigger
 language plpgsql
 set search_path to 'portal', 'public'
as $function$
begin
  -- Staff, and anything that is not a portal role, are not limited here.
  if current_user not in ('authenticated', 'anon') or portal.is_kui_staff() then
    return new;
  end if;
  if (to_jsonb(new) - array['requested_date', 'note', 'status'])
     is distinct from (to_jsonb(old) - array['requested_date', 'note', 'status']) then
    raise exception 'A delivery request can only have its date and note changed from the portal.'
      using errcode = 'check_violation';
  end if;
  if new.status::text is distinct from 'requested' then
    raise exception 'A changed delivery request goes back to KUI as requested.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

create trigger trg_dr_client_update_guard
  before update on portal.delivery_requests
  for each row execute function portal.dr_client_update_guard();

-- PROBE SETUP, as postgres. The non-KUI ZZDELIV login, its newest request that
-- is still requested, and any request of another company.
select set_config('zz90.uid', coalesce((
         select u.auth_user_id::text from portal.users u
           join vessl.companies c on c.id = u.company_id
          where c.name = 'ZZDELIV' and c.type::text = 'client' and u.status::text = 'approved'
            and u.email not ilike '%@kinguniversal.com'
          order by u.email limit 1), ''), true),
       set_config('zz90.email', coalesce((
         select u.email from portal.users u
           join vessl.companies c on c.id = u.company_id
          where c.name = 'ZZDELIV' and c.type::text = 'client' and u.status::text = 'approved'
            and u.email not ilike '%@kinguniversal.com'
          order by u.email limit 1), ''), true),
       set_config('zz90.req', coalesce((
         select d.id::text from portal.delivery_requests d
           join vessl.companies c on c.id = d.client_company_id
          where c.name = 'ZZDELIV' and d.status::text = 'requested'
          order by d.created_at desc limit 1), ''), true),
       set_config('zz90.other', coalesce((
         select d.id::text from portal.delivery_requests d
           left join vessl.companies c on c.id = d.client_company_id
          where coalesce(c.name, '') <> 'ZZDELIV'
          order by d.created_at desc limit 1), ''), true);

select set_config('request.jwt.claims',
         case when current_setting('zz90.uid') = '' then ''
              else json_build_object('sub', current_setting('zz90.uid'),
                                     'email', current_setting('zz90.email'),
                                     'role', 'authenticated')::text end, true),
       set_config('request.jwt.claim.sub', current_setting('zz90.uid'), true);

set local role authenticated;

do $probe$
declare
  r text;
  n int;
  res text := '';
begin
  if current_setting('zz90.uid') = '' or current_setting('zz90.req') = '' then
    perform set_config('zz90.result', 'skipped', true);
    return;
  end if;

  begin
    update portal.delivery_requests
       set requested_date = requested_date + 1, note = 'zz 90 probe', status = 'requested'
     where id = current_setting('zz90.req')::uuid;
    get diagnostics n = row_count;
    raise exception 'rows %', n;
  exception
    when check_violation or insufficient_privilege then r := 'refused';
    when others then r := sqlerrm;
  end;
  res := r;

  begin
    update portal.delivery_requests set kui_response_note = 'zz 90 probe'
     where id = current_setting('zz90.req')::uuid;
    get diagnostics n = row_count;
    raise exception 'rows %', n;
  exception
    when check_violation or insufficient_privilege then r := 'refused';
    when others then r := sqlerrm;
  end;
  res := res || '/' || r;

  begin
    update portal.delivery_requests set status = 'confirmed'
     where id = current_setting('zz90.req')::uuid;
    get diagnostics n = row_count;
    raise exception 'rows %', n;
  exception
    when check_violation or insufficient_privilege then r := 'refused';
    when others then r := sqlerrm;
  end;
  res := res || '/' || r;

  if current_setting('zz90.other') = '' then
    r := 'skipped';
  else
    begin
      update portal.delivery_requests set note = 'zz 90 probe'
       where id = current_setting('zz90.other')::uuid;
      get diagnostics n = row_count;
      raise exception 'rows %', n;
    exception
      when check_violation or insufficient_privilege then r := 'refused';
      when others then r := sqlerrm;
    end;
  end if;
  res := res || '/' || r;

  perform set_config('zz90.result', res, true);
end
$probe$;

reset role;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 four policies, no dr_client_update, no guard trigger or function' as chk,
         (select pols_before::text || '/' || new_pol_before::text || '/' || (trg_before + fn_before)::text
            from _pre90) as got,
         '4/0/0' as want
  union all
  select 'b1 dr_client_update is a permissive UPDATE policy for authenticated',
         (select polcmd::text || '/' || polpermissive::text || '/' || polroles::regrole[]::text
            from pg_policy where polrelid = 'portal.delivery_requests'::regclass
                             and polname = 'dr_client_update'),
         'w/true/{authenticated}'
  union all
  select 'b2 its USING and WITH CHECK both scope to the own company and name the statuses',
         (select (position('my_company_id' in pg_get_expr(polqual, polrelid)) > 0)::text || '/'
                 || (position('declined' in pg_get_expr(polqual, polrelid)) > 0)::text || '/'
                 || (position('my_company_id' in pg_get_expr(polwithcheck, polrelid)) > 0)::text || '/'
                 || (position('requested' in pg_get_expr(polwithcheck, polrelid)) > 0)::text
            from pg_policy where polrelid = 'portal.delivery_requests'::regclass
                             and polname = 'dr_client_update'),
         'true/true/true/true'
  union all
  select 'b3 the four existing policies are unchanged',
         (select string_agg(polname || ' ' || polcmd::text || ' ' || polpermissive::text || ' '
                            || coalesce(pg_get_expr(polqual, polrelid), '') || ' / '
                            || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ' || ' order by polname)
            from pg_policy where polrelid = 'portal.delivery_requests'::regclass
                             and polname <> 'dr_client_update'),
         (select pols_text_before from _pre90)
  union all
  select 'c1 the grant on delivery_requests is unchanged',
         (select relacl::text from pg_class where oid = 'portal.delivery_requests'::regclass),
         (select acl_before from _pre90)
  union all
  -- 19 is BEFORE UPDATE FOR EACH ROW -- 1 + 2 + 16.
  select 'd1 the guard trigger is BEFORE UPDATE row level, enabled, all columns, no WHEN',
         (select tgtype::text || '/' || tgenabled::text || '/' || (tgattr[0] is null)::text || '/'
                 || (tgqual is null)::text || '/' || tgfoid::regproc::text
            from pg_trigger where tgrelid = 'portal.delivery_requests'::regclass
                              and tgname = 'trg_dr_client_update_guard'),
         '19/O/true/true/portal.dr_client_update_guard'
  union all
  select 'd2 the notify trigger from script 86 is still in place',
         (select tgtype::text from pg_trigger where tgrelid = 'portal.delivery_requests'::regclass
                                                and tgname = 'trg_notify_delivery_request'), '21'
  union all
  select 'd4 the guard function is SECURITY INVOKER -- current_user is how it tells a client apart',
         (select prosecdef::text from pg_proc where oid = 'portal.dr_client_update_guard'::regproc), 'false'
  union all
  select 'e1 no delivery request was changed by the probes',
         (select md5(coalesce(string_agg(to_jsonb(d)::text, '/' order by d.id), ''))
            from portal.delivery_requests d),
         (select rows_before from _pre90)
  union all
  select 'p1 probes as the non-KUI ZZDELIV login -- change, staff column, confirm, other company',
         current_setting('zz90.result', true)::text,
         case when current_setting('zz90.uid', true) = '' or current_setting('zz90.req', true) = '' then 'skipped'
              when current_setting('zz90.other', true) = '' then 'rows 1/refused/refused/skipped'
              else 'rows 1/refused/refused/rows 0' end
  union all
  select 'r0 probe login used, blank when none -- shown every run',
         coalesce(nullif(current_setting('zz90.email', true), ''), 'none')::text,
         'shown every run'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r0? Then swap these two lines.
-- commit;
rollback;
