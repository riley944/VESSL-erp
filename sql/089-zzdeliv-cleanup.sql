-- 89 -- Remove the ZZDELIV test rig from scripts 88 and 91. KEEPS mattdillon+bgtest.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction.
--
-- WHAT GOES, all by id
--   portal.delivery_requests   aed54289  ZZDELIV-PO-001, cancelled
--   vessl.shipment_pos         ZZDELIV-SH-001 to ZZDELIV-PO-001
--   vessl.sales_order_pos      ZZDELIV-SO-001 to ZZDELIV-PO-001
--   vessl.shipments            cff0043f  ZZDELIV-SH-001
--   vessl.purchase_orders      e4bc056d  ZZDELIV-PO-001
--   vessl.sales_orders         37ecca25  ZZDELIV-SO-001
--   portal.users               52bd6b50  <test login>, 76606fcb  <test login>
--   auth.users                 ac1f52af  +zzdeliv, 949ab90b  +zzclient -- identities go with them
--   vessl.companies            eeb055ce  ZZDELIV client with its 2 extras, c4ba35b4  ZZDELIV factory
--
-- WHAT STAYS, and is proven unchanged
--   mattdillon+bgtest -- portal.users d1245578 and auth.users fa4f1bb7, bound to the
--   real BucketGolf. Not revoked, not banned, not signed out. Its rows hash the same
--   before and after, and its session and token counts do not move (b3 to b5).
--   BucketGolf, its recipients, every other company, every other portal user, and
--   the older ZZ companies from last week (b6 to b9).
--   The vault. This script never names it.
--
-- ORDER
--   1. GUARDS, before any write. Every id resolves to what it should, paired with
--      name and email lengths. Exact counts. Nothing else hangs off these rows,
--      so no cascade can reach past them. No enabled trigger on a touched table
--      fires on DELETE, and none on a table this script updates calls http_post
--      or Resend.
--   2. REVOKE, the two ZZ logins only. Their refresh tokens and sessions are
--      deleted, banned_until is set 100 years out, portal status becomes revoked.
--      A second guard counts all four before anything is deleted.
--   3. DELETE, children before parents, so no foreign key ever nulls a column --
--      a null-out is an UPDATE and would fire the sync triggers.
--
-- NO EMAIL. The only mailing triggers are on portal.delivery_requests (insert and
-- update) and portal.messages (insert). This script deletes one delivery request
-- and never inserts into or updates either table. b10 proves no request was
-- queued for pg_net during the transaction.
--
-- WHAT A PASS LOOKS LIKE. r0 (the revoke step) and r1 to r9 (one per delete)
-- always show, plus z0. Any a or b row is a failed check.
--
-- b3 to b5 and b10 compare against rows other sessions can write. If the +bgtest
-- browser refreshes its token, or pg_net finishes some other request, in the
-- seconds this runs, one of them can show. Rerun the rehearsal before reading it
-- as a fault.

begin;

create temp table _k89 on commit drop as
  select 'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid as zz_client,
         'c4ba35b4-ae0a-4bd2-a218-72de143d025c'::uuid as zz_factory,
         'aed54289-6763-4b15-ac27-25c3f191eb37'::uuid as dr_id,
         '37ecca25-2dd6-47f4-be11-b7a7db2799b7'::uuid as so_id,
         'e4bc056d-a249-40c3-8fb8-cd9129a646c8'::uuid as po_id,
         'cff0043f-7325-48ba-82dc-bfc2fbd7297a'::uuid as sh_id,
         '52bd6b50-6c66-4d3e-8821-80098ca35410'::uuid as pu_zzdeliv,
         '76606fcb-9891-4c43-89da-5f7529a3b4aa'::uuid as pu_zzclient,
         'ac1f52af-4132-49de-8863-c14d8b76844b'::uuid as au_zzdeliv,
         '949ab90b-74fc-438c-bbc0-d257b00e1167'::uuid as au_zzclient,
         '771dc750-929c-4b8f-a279-53404e94da60'::uuid as bg_co,
         'd1245578-f4d2-405e-ae87-1e01f8fcc23e'::uuid as bg_pu,
         'fa4f1bb7-868a-4b53-ad50-8c58f970bcc7'::uuid as bg_au;

create temp table _pre89 on commit drop as
  select
    -- Identity. Each target by id, with the lengths of its name or email.
    (select length(name)::text || ' ' || type::text from vessl.companies where id = k.zz_client)
      || ' | ' || (select length(name)::text || ' ' || type::text from vessl.companies where id = k.zz_factory)
      || ' | ' || (select length(shipment_ref)::text || ' ' || (client_company_id = k.zz_client)::text
                     from portal.delivery_requests where id = k.dr_id)
      || ' | ' || (select length(so_number)::text || ' ' || (client_company_id = k.zz_client)::text
                     from vessl.sales_orders where id = k.so_id)
      || ' | ' || (select length(order_number)::text || ' ' || (client_company_id = k.zz_client)::text
                          || ' ' || (factory_company_id = k.zz_factory)::text
                     from vessl.purchase_orders where id = k.po_id)
      || ' | ' || (select length(shipment_number)::text || ' ' || (client_company_id = k.zz_client)::text
                     from vessl.shipments where id = k.sh_id)
      || ' | ' || (select length(u.email)::text || ' ' || (u.company_id = k.zz_client)::text || ' '
                          || (u.auth_user_id = k.au_zzdeliv)::text || ' ' || length(a.email)::text
                     from portal.users u join auth.users a on a.id = u.auth_user_id where u.id = k.pu_zzdeliv)
      || ' | ' || (select length(u.email)::text || ' ' || (u.company_id = k.zz_client)::text || ' '
                          || (u.auth_user_id = k.au_zzclient)::text || ' ' || length(a.email)::text
                     from portal.users u join auth.users a on a.id = u.auth_user_id where u.id = k.pu_zzclient)
      || ' | ' || (select length(u.email)::text || ' ' || (u.company_id = k.bg_co)::text || ' '
                          || (u.auth_user_id = k.bg_au)::text || ' ' || length(a.email)::text || ' ' || length(c.name)::text
                     from portal.users u join auth.users a on a.id = u.auth_user_id
                     join vessl.companies c on c.id = u.company_id where u.id = k.bg_pu)          as ident,

    -- Exact counts of what goes. Each is wider than the ids, so a stray row fails it.
    (select count(*) from portal.delivery_requests
      where id = k.dr_id or client_company_id in (k.zz_client, k.zz_factory))                    as n_dr,
    (select count(*) from vessl.sales_order_pos where sales_order_id = k.so_id or purchase_order_id = k.po_id)
      + (select count(*) from vessl.shipment_pos where shipment_id = k.sh_id or purchase_order_id = k.po_id) as n_link,
    (select count(*) from vessl.shipments
      where id = k.sh_id or client_company_id in (k.zz_client, k.zz_factory))                    as n_sh,
    (select count(*) from vessl.purchase_orders
      where id = k.po_id or client_company_id in (k.zz_client, k.zz_factory)
         or factory_company_id in (k.zz_client, k.zz_factory))                                   as n_po,
    (select count(*) from vessl.sales_orders
      where id = k.so_id or client_company_id in (k.zz_client, k.zz_factory))                    as n_so,
    (select count(*) from portal.users
      where id in (k.pu_zzdeliv, k.pu_zzclient) or company_id in (k.zz_client, k.zz_factory))    as n_pu,
    (select count(*) from auth.users where id in (k.au_zzdeliv, k.au_zzclient))                  as n_au,
    (select count(*) from auth.identities where user_id in (k.au_zzdeliv, k.au_zzclient))        as n_ident,
    (select count(*) from vessl.companies where id in (k.zz_client, k.zz_factory))               as n_co,

    -- Recorded, not required. Must be zero after.
    (select count(*) from auth.sessions where user_id in (k.au_zzdeliv, k.au_zzclient))          as n_sess,
    (select count(*) from auth.refresh_tokens
      where user_id in (k.au_zzdeliv::text, k.au_zzclient::text))                                as n_rt,

    -- Anything else hanging off these rows. Must be zero, or a cascade reaches past them.
    (select count(*) from vessl.addresses where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.contacts where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.company_container_watchlist where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from portal.client_tasks where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from portal.messages where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from portal.notifications where company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from portal.order_notes
          where company_id in (k.zz_client, k.zz_factory) or sales_order_id = k.so_id)
      + (select count(*) from portal.threads
          where company_id in (k.zz_client, k.zz_factory) or sales_order_id = k.so_id)
      + (select count(*) from portal.price_list_items where client_company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.containers
          where client_company_id in (k.zz_client, k.zz_factory) or shipment_id = k.sh_id)
      + (select count(*) from vessl.freight_invoices
          where forwarder_company_id in (k.zz_client, k.zz_factory) or shipment_id = k.sh_id)
      + (select count(*) from vessl.materials where supplier_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.products where client_company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.programs where client_company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.quotes where client_company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.shipment_quotes
          where forwarder_company_id in (k.zz_client, k.zz_factory)
             or client_company_id in (k.zz_client, k.zz_factory) or po_id = k.po_id)
      + (select count(*) from vessl.shipments
          where freight_forwarder_company_id in (k.zz_client, k.zz_factory)
             or carrier_company_id in (k.zz_client, k.zz_factory))
      + (select count(*) from vessl.freight_allocations where po_id = k.po_id)
      + (select count(*) from vessl.order_notes where purchase_order_id = k.po_id)
      + (select count(*) from vessl.purchase_order_items where purchase_order_id = k.po_id)
      + (select count(*) from vessl.receipts where purchase_order_id = k.po_id)
      + (select count(*) from vessl.order_costs where sales_order_id = k.so_id)
      + (select count(*) from vessl.sales_order_items where sales_order_id = k.so_id)
      + (select count(*) from vessl.tracking_events where shipment_id = k.sh_id)                as n_deps,

    -- Triggers. None may fire on DELETE on any touched table. None on a touched
    -- table other than delivery_requests may call http_post or Resend -- that
    -- covers the two tables this script UPDATEs.
    (select coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', '), 'none')
       from pg_trigger t
      where not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 8) > 0
        and t.tgrelid in ('portal.delivery_requests'::regclass, 'vessl.shipment_pos'::regclass,
                          'vessl.sales_order_pos'::regclass, 'vessl.shipments'::regclass,
                          'vessl.purchase_orders'::regclass, 'vessl.sales_orders'::regclass,
                          'portal.users'::regclass, 'auth.users'::regclass, 'auth.identities'::regclass,
                          'auth.sessions'::regclass, 'auth.refresh_tokens'::regclass,
                          'vessl.companies'::regclass))                                          as del_trg,
    (select coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', '), 'none')
       from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and t.tgenabled <> 'D'
        and (position('http_post' in lower(p.prosrc)) > 0 or position('resend' in lower(p.prosrc)) > 0)
        and t.tgrelid in ('vessl.shipment_pos'::regclass, 'vessl.sales_order_pos'::regclass,
                          'vessl.shipments'::regclass, 'vessl.purchase_orders'::regclass,
                          'vessl.sales_orders'::regclass, 'portal.users'::regclass, 'auth.users'::regclass,
                          'auth.identities'::regclass, 'auth.sessions'::regclass,
                          'auth.refresh_tokens'::regclass, 'vessl.companies'::regclass))         as mail_trg,

    -- +bgtest, kept.
    (select md5(to_jsonb(u)::text) from portal.users u where u.id = k.bg_pu)                     as h_bg_pu,
    (select md5(to_jsonb(a)::text) from auth.users a where a.id = k.bg_au)                       as h_bg_au,
    (select count(*) from auth.sessions where user_id = k.bg_au)                                 as bg_sess,
    (select count(*) from auth.refresh_tokens where user_id = k.bg_au::text)                     as bg_rt,
    (select count(*) from auth.identities where user_id = k.bg_au)                               as bg_ident,

    -- Everything else, kept.
    (select md5(to_jsonb(c)::text) from vessl.companies c where c.id = k.bg_co)                  as h_bg_co,
    (select c.delivery_request_recipients from vessl.companies c where c.id = k.bg_co)           as bg_recips,
    (select md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
       from vessl.companies c where c.id not in (k.zz_client, k.zz_factory))                     as h_other_co,
    (select count(*) from vessl.companies c
      where c.name like 'ZZ%' and c.id not in (k.zz_client, k.zz_factory))                       as n_old_zz,
    (select md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
       from vessl.companies c where c.name like 'ZZ%' and c.id not in (k.zz_client, k.zz_factory)) as h_old_zz,
    (select md5(coalesce(string_agg(to_jsonb(u)::text, '/' order by u.id), ''))
       from portal.users u where u.id not in (k.pu_zzdeliv, k.pu_zzclient))                      as h_other_pu,

    -- Table totals, to prove each drops by exactly what was deleted.
    (select count(*) from portal.delivery_requests)                                              as t_dr,
    (select count(*) from vessl.sales_order_pos) + (select count(*) from vessl.shipment_pos)     as t_link,
    (select count(*) from vessl.shipments)                                                       as t_sh,
    (select count(*) from vessl.purchase_orders)                                                 as t_po,
    (select count(*) from vessl.sales_orders)                                                    as t_so,
    (select count(*) from portal.users)                                                          as t_pu,
    (select count(*) from auth.users)                                                            as t_au,
    (select count(*) from auth.identities)                                                       as t_ident,
    (select count(*) from vessl.companies)                                                       as t_co,

    -- pg_net high-water marks.
    (select coalesce(max(id), 0) from net.http_request_queue)                                    as q_max,
    (select coalesce(max(id), 0) from net._http_response)                                        as r_max
  from _k89 k;

do $guard$
begin
  if (select ident from _pre89) is distinct from
     '7 client | 15 factory | 14 true | 14 true | 14 true true | 14 true | 36 true true 36 | 33 true true 33 | 35 true true 35 10' then
    raise exception 'an id does not resolve to the expected row, nothing changed -- %', (select ident from _pre89);
  end if;
  if (select n_dr::text || '/' || n_link::text || '/' || n_sh::text || '/' || n_po::text || '/' || n_so::text
             || '/' || n_pu::text || '/' || n_au::text || '/' || n_ident::text || '/' || n_co::text from _pre89)
     is distinct from '1/2/1/1/1/2/2/2/2' then
    raise exception 'the counts are not 1/2/1/1/1/2/2/2/2, nothing changed';
  end if;
  if (select n_deps from _pre89) <> 0 then
    raise exception 'other rows hang off the ZZDELIV rows and a cascade would reach them, nothing changed';
  end if;
  if (select del_trg from _pre89) <> 'none' or (select mail_trg from _pre89) <> 'none' then
    raise exception 'a trigger on a touched table fires on delete or may send mail, nothing changed';
  end if;
end
$guard$;

-- REVOKE, the two ZZ logins only
create temp table _rev89 (step int, label text, n bigint) on commit drop;

with d as (delete from auth.refresh_tokens
            where user_id in (select au_zzdeliv::text from _k89 union all select au_zzclient::text from _k89)
           returning id)
insert into _rev89 select 1, 'refresh tokens ended', count(*) from d;

with d as (delete from auth.sessions
            where user_id in (select au_zzdeliv from _k89 union all select au_zzclient from _k89)
           returning id)
insert into _rev89 select 2, 'sessions ended', count(*) from d;

with u as (update auth.users set banned_until = now() + interval '100 years'
            where id in (select au_zzdeliv from _k89 union all select au_zzclient from _k89)
           returning id)
insert into _rev89 select 3, 'auth users banned', count(*) from u;

with u as (update portal.users set status = 'revoked'
            where id in (select pu_zzdeliv from _k89 union all select pu_zzclient from _k89)
           returning id)
insert into _rev89 select 4, 'portal users revoked', count(*) from u;

do $revoked$
begin
  if (select count(*) from auth.refresh_tokens, _k89 k
       where user_id in (k.au_zzdeliv::text, k.au_zzclient::text)) <> 0
     or (select count(*) from auth.sessions, _k89 k where user_id in (k.au_zzdeliv, k.au_zzclient)) <> 0
     or (select count(*) from auth.users, _k89 k
          where id in (k.au_zzdeliv, k.au_zzclient) and banned_until > now() + interval '99 years') <> 2
     or (select count(*) from portal.users, _k89 k
          where id in (k.pu_zzdeliv, k.pu_zzclient) and status = 'revoked') <> 2
     or (select n from _rev89 where step = 1) <> (select n_rt from _pre89)
     or (select n from _rev89 where step = 2) <> (select n_sess from _pre89) then
    raise exception 'the revoke step did not land as counted, nothing deleted';
  end if;
end
$revoked$;

-- DELETE, children before parents
create temp table _del89 (step int, tbl text, n bigint, detail text) on commit drop;

with d as (delete from portal.delivery_requests where id = (select dr_id from _k89)
           returning shipment_ref || ' ' || status as x)
insert into _del89 select 1, 'portal.delivery_requests', count(*), string_agg(x, ', ') from d;

with d as (delete from vessl.shipment_pos
            where shipment_id = (select sh_id from _k89) and purchase_order_id = (select po_id from _k89)
           returning 1)
insert into _del89 select 2, 'vessl.shipment_pos', count(*), 'SH-001 to PO-001' from d;

with d as (delete from vessl.sales_order_pos
            where sales_order_id = (select so_id from _k89) and purchase_order_id = (select po_id from _k89)
           returning 1)
insert into _del89 select 3, 'vessl.sales_order_pos', count(*), 'SO-001 to PO-001' from d;

with d as (delete from vessl.shipments where id = (select sh_id from _k89) returning shipment_number as x)
insert into _del89 select 4, 'vessl.shipments', count(*), string_agg(x, ', ') from d;

with d as (delete from vessl.purchase_orders where id = (select po_id from _k89) returning order_number as x)
insert into _del89 select 5, 'vessl.purchase_orders', count(*), string_agg(x, ', ') from d;

with d as (delete from vessl.sales_orders where id = (select so_id from _k89) returning so_number as x)
insert into _del89 select 6, 'vessl.sales_orders', count(*), string_agg(x, ', ') from d;

with d as (delete from portal.users
            where id in (select pu_zzdeliv from _k89 union all select pu_zzclient from _k89)
           returning email as x)
insert into _del89 select 7, 'portal.users', count(*), string_agg(x, ', ' order by x) from d;

with d as (delete from auth.users
            where id in (select au_zzdeliv from _k89 union all select au_zzclient from _k89)
           returning email as x)
insert into _del89 select 8, 'auth.users', count(*), string_agg(x, ', ' order by x) from d;

with d as (delete from vessl.companies
            where id in (select zz_client from _k89 union all select zz_factory from _k89)
           returning name || ' ' || type::text as x)
insert into _del89 select 9, 'vessl.companies', count(*), string_agg(x, ', ' order by x) from d;

-- VERIFICATION. r0 to r9 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r0 revoke step' as chk,
         (select string_agg(label || ' ' || n::text, ', ' order by step) from _rev89)::text as got,
         'shown every run' as want
  union all
  select 'r' || step::text || ' deleted from ' || tbl, n::text || ' -- ' || coalesce(detail, 'none'), 'shown every run'
    from _del89
  union all
  select 'a0 targets resolve by id, with name and email lengths',
         (select ident::text from _pre89),
         '7 client | 15 factory | 14 true | 14 true | 14 true true | 14 true | 36 true true 36 | 33 true true 33 | 35 true true 35 10'
  union all
  select 'a1 exact counts before -- request, links, shipment, PO, SO, portal users, auth users, identities, companies',
         (select n_dr::text || '/' || n_link::text || '/' || n_sh::text || '/' || n_po::text || '/' || n_so::text
                 || '/' || n_pu::text || '/' || n_au::text || '/' || n_ident::text || '/' || n_co::text from _pre89),
         '1/2/1/1/1/2/2/2/2'
  union all
  select 'a2 nothing else hangs off the ZZDELIV rows',
         (select n_deps::text from _pre89), '0'
  union all
  select 'a3 no delete trigger on a touched table, no mailing trigger outside delivery_requests',
         (select del_trg || '/' || mail_trg from _pre89), 'none/none'
  union all
  select 'b0 rows deleted per step, in order',
         (select string_agg(n::text, '/' order by step) from _del89), '1/1/1/1/1/1/2/2/2'
  union all
  select 'b1 nothing left for these ids -- the nine counts, then sessions and tokens of the two logins',
         (select (select count(*) from portal.delivery_requests
                   where id = k.dr_id or client_company_id in (k.zz_client, k.zz_factory))::text
                 || '/' || ((select count(*) from vessl.sales_order_pos where sales_order_id = k.so_id or purchase_order_id = k.po_id)
                          + (select count(*) from vessl.shipment_pos where shipment_id = k.sh_id or purchase_order_id = k.po_id))::text
                 || '/' || (select count(*) from vessl.shipments
                             where id = k.sh_id or client_company_id in (k.zz_client, k.zz_factory))::text
                 || '/' || (select count(*) from vessl.purchase_orders
                             where id = k.po_id or client_company_id in (k.zz_client, k.zz_factory)
                                or factory_company_id in (k.zz_client, k.zz_factory))::text
                 || '/' || (select count(*) from vessl.sales_orders
                             where id = k.so_id or client_company_id in (k.zz_client, k.zz_factory))::text
                 || '/' || (select count(*) from portal.users
                             where id in (k.pu_zzdeliv, k.pu_zzclient) or company_id in (k.zz_client, k.zz_factory))::text
                 || '/' || (select count(*) from auth.users where id in (k.au_zzdeliv, k.au_zzclient))::text
                 || '/' || (select count(*) from auth.identities where user_id in (k.au_zzdeliv, k.au_zzclient))::text
                 || '/' || (select count(*) from vessl.companies where id in (k.zz_client, k.zz_factory))::text
                 || '/' || (select count(*) from auth.sessions where user_id in (k.au_zzdeliv, k.au_zzclient))::text
                 || '/' || (select count(*) from auth.refresh_tokens
                             where user_id in (k.au_zzdeliv::text, k.au_zzclient::text))::text
            from _k89 k), '0/0/0/0/0/0/0/0/0/0/0'
  union all
  select 'b2 each table total dropped by exactly the rows deleted',
         (select (p.t_dr - (select count(*) from portal.delivery_requests))::text
                 || '/' || (p.t_link - (select count(*) from vessl.sales_order_pos) - (select count(*) from vessl.shipment_pos))::text
                 || '/' || (p.t_sh - (select count(*) from vessl.shipments))::text
                 || '/' || (p.t_po - (select count(*) from vessl.purchase_orders))::text
                 || '/' || (p.t_so - (select count(*) from vessl.sales_orders))::text
                 || '/' || (p.t_pu - (select count(*) from portal.users))::text
                 || '/' || (p.t_au - (select count(*) from auth.users))::text
                 || '/' || (p.t_ident - (select count(*) from auth.identities))::text
                 || '/' || (p.t_co - (select count(*) from vessl.companies))::text
            from _pre89 p), '1/2/1/1/1/2/2/2/2'
  union all
  select 'b3 bgtest portal.users row unchanged',
         (select md5(to_jsonb(u)::text) from portal.users u, _k89 k where u.id = k.bg_pu),
         (select h_bg_pu from _pre89)
  union all
  select 'b4 bgtest auth.users row unchanged',
         (select md5(to_jsonb(a)::text) from auth.users a, _k89 k where a.id = k.bg_au),
         (select h_bg_au from _pre89)
  union all
  select 'b5 bgtest sessions, refresh tokens and identities unchanged',
         (select (select count(*) from auth.sessions where user_id = k.bg_au)::text
                 || '/' || (select count(*) from auth.refresh_tokens where user_id = k.bg_au::text)::text
                 || '/' || (select count(*) from auth.identities where user_id = k.bg_au)::text
            from _k89 k),
         (select bg_sess::text || '/' || bg_rt::text || '/' || bg_ident::text from _pre89)
  union all
  select 'b6 BucketGolf company row and recipients unchanged',
         (select md5(to_jsonb(c)::text) || '/' || (c.delivery_request_recipients is not distinct from p.bg_recips)::text
            from vessl.companies c, _k89 k, _pre89 p where c.id = k.bg_co),
         (select h_bg_co || '/true' from _pre89)
  union all
  select 'b7 every other company unchanged',
         (select md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
            from vessl.companies c, _k89 k where c.id not in (k.zz_client, k.zz_factory)),
         (select h_other_co from _pre89)
  union all
  select 'b8 older ZZ companies unchanged -- count and rows',
         (select count(*)::text || '/' || md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
            from vessl.companies c, _k89 k where c.name like 'ZZ%' and c.id not in (k.zz_client, k.zz_factory)),
         (select n_old_zz::text || '/' || h_old_zz from _pre89)
  union all
  select 'b9 every other portal user unchanged',
         (select md5(coalesce(string_agg(to_jsonb(u)::text, '/' order by u.id), ''))
            from portal.users u, _k89 k where u.id not in (k.pu_zzdeliv, k.pu_zzclient)),
         (select h_other_pu from _pre89)
  union all
  select 'b10 nothing queued for pg_net, no new response row',
         (select (select count(*) from net.http_request_queue where id > p.q_max)::text
                 || '/' || (select count(*) from net._http_response where id > p.r_max)::text
            from _pre89 p), '0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r0 to r9? Then swap these two lines.
-- commit;
rollback;
