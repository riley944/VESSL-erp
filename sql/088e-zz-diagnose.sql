-- 88e -- Why no ZZDELIV request was inserted. Writes nothing.
--
-- RUN AS postgres. Ends in rollback and has no commit line.
--
-- PART 1, as postgres -- the rows 88 wrote. Is the login approved, bound to
-- ZZDELIV, tied to a real auth user whose email is confirmed? Does the
-- shipment still meet the button conditions, and does the order reach it?
--
-- PART 2, as the +zzdeliv user. The transaction switches to role
-- authenticated with that user as the JWT, which is how PostgREST runs the
-- portal requests, and reads exactly what the portal reads -- portal.me,
-- portal.orders, portal.order_logistics. Then it tries the same insert the
-- request button sends, inside a block that always undoes it. That insert
-- fires the notify trigger, but the email is only a queued row in the same
-- block, and it is undone with the insert, so nothing is sent. The outer
-- rollback is a second guarantee.
--
-- Results from part 2 are carried out in transaction settings named zz88e,
-- because the role switch cannot write to temp tables made by postgres.

begin;

-- PART 2 first, so the role switch happens once and is reset before the checks.
select set_config('request.jwt.claims',
         (select json_build_object('sub', u.auth_user_id::text, 'email', u.email, 'role', 'authenticated')::text
            from portal.users u where u.email = '<test login>'), true),
       set_config('request.jwt.claim.sub',
         (select u.auth_user_id::text from portal.users u
           where u.email = '<test login>'), true);

set local role authenticated;

do $asuser$
declare
  r text;
begin
  perform set_config('zz88e.me',
    coalesce((select coalesce(m.status::text, 'null') || '/' || coalesce(m.company_id::text, 'null')
                from portal.me m limit 1), 'no row'), true);
  perform set_config('zz88e.orders',
    (select count(*)::text from portal.orders o where o.so_number = 'ZZDELIV-SO-001'), true);
  perform set_config('zz88e.logistics',
    (select count(*)::text || '/' || count(*) filter (where l.estimated_arrival is not null
                                                        and l.actual_arrival is null)::text
       from portal.order_logistics l
       join portal.orders o on o.id = l.sales_order_id
      where o.so_number = 'ZZDELIV-SO-001'), true);
  begin
    insert into portal.delivery_requests (client_company_id, shipment_ref, container_no, eta,
                                          requested_date, requested_by, note, status)
    select m.company_id, 'ZZDELIV-PO-001', null, current_date + 14, current_date + 15,
           '<test login>', 'zz 88e probe, undone', 'requested'
      from portal.me m limit 1;
    raise exception 'accepted';
  exception
    when others then r := sqlerrm;
  end;
  perform set_config('zz88e.insert', r, true);
end
$asuser$;

reset role;

select * from (
  select 'u1 login approved, bound to ZZDELIV, real auth user, email confirmed' as chk,
         (select u.status::text || '/' || (u.company_id = c.id)::text || '/'
                 || (a.id is not null)::text || '/' || (a.email_confirmed_at is not null)::text
            from portal.users u
            join vessl.companies c on c.name = 'ZZDELIV' and c.type::text = 'client'
            left join auth.users a on a.id = u.auth_user_id
           where u.email = '<test login>') as got,
         'approved/true/true/true' as want
  union all
  select 'u2 exactly one portal.users row for +zzdeliv',
         (select count(*)::text from portal.users where email = '<test login>'), '1'
  union all
  select 's1 shipment -- ETA in the future, no actual arrival, in transit',
         (select (estimated_arrival > now())::text || '/' || (actual_arrival is null)::text || '/' || status::text
            from vessl.shipments where shipment_number = 'ZZDELIV-SH-001'), 'true/true/in_transit'
  union all
  select 's2 the sales order reaches the shipment through its PO',
         (select count(*)::text
            from vessl.sales_orders so
            join vessl.sales_order_pos sop on sop.sales_order_id = so.id
            join vessl.shipment_pos shp on shp.purchase_order_id = sop.purchase_order_id
            join vessl.shipments sh on sh.id = shp.shipment_id
           where so.so_number = 'ZZDELIV-SO-001' and sh.shipment_number = 'ZZDELIV-SH-001'), '1'
  union all
  select 'p1 as the user -- portal.me is approved and on ZZDELIV',
         (select case when split_part(current_setting('zz88e.me', true), '/', 2) = c.id::text
                      then split_part(current_setting('zz88e.me', true), '/', 1) || '/ZZDELIV'
                      else current_setting('zz88e.me', true) end
            from vessl.companies c where c.name = 'ZZDELIV' and c.type::text = 'client'),
         'approved/ZZDELIV'
  union all
  select 'p2 as the user -- portal.orders shows ZZDELIV-SO-001',
         current_setting('zz88e.orders', true)::text, '1'
  union all
  select 'p3 as the user -- logistics rows for it, and rows that show the button',
         current_setting('zz88e.logistics', true)::text, '1/1'
  union all
  select 'p4 as the user -- the request insert the button sends',
         current_setting('zz88e.insert', true)::text, 'accepted'
  union all
  select 'p5 no ZZDELIV request exists after the probe',
         (select count(*)::text from portal.delivery_requests d
            join vessl.companies c on c.id = d.client_company_id
           where c.name = 'ZZDELIV'), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

rollback;
