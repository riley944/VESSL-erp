-- 88 -- ZZ test rows for the per-client delivery-request recipients (script 86).
--
-- STEP 0, BEFORE THIS SCRIPT. Sign up at kui.vessl.io on the Request access
-- tab as <test login>, company ZZDELIV. That creates
-- the auth user and a pending portal.users row, the same way a real client
-- arrives. Supabase may send a confirmation email to +zzdeliv -- click it if
-- it does. That email is from Supabase, not from this feature.
--
-- WHAT IT DOES. One transaction, all rows named ZZDELIV so they are easy to
-- find and remove.
--   1. A ZZ factory company, ZZDELIV factory, so the test PO does not name a
--      real factory.
--   2. A ZZ client company, ZZDELIV, whose delivery_request_recipients holds
--      <test login> and mattdillon. During the test the vault points at
--      mattdillon, so a working merge sends to exactly those two addresses,
--      once each. If the extras were ignored, +zzextra would be missing.
--   3. The chain the portal walks -- sales order ZZDELIV-SO-001 with client PO
--      ZZDELIV-PO-001, purchase order ZZDELIV-PO-001, sales_order_pos, a
--      shipment ZZDELIV-SH-001 in transit with an ETA 14 days out and no
--      actual arrival (the portal shows the request button only then), and
--      shipment_pos. The portal will write ZZDELIV-PO-001 into shipment_ref.
--   4. Approves the pending portal user for ZZDELIV.
-- No line items. The order shows a zero total, which does not matter here.
--
-- GUARDS. Stops before writing if script 86 is not live, if any ZZDELIV row
-- already exists, if the signup is missing or already approved, or if ANY
-- enabled trigger on a table touched here runs a function that mentions http.
-- The last one is the important one -- nothing in this script may send mail.

begin;

create temp table _pre88 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies'
             and column_name = 'delivery_request_recipients')                          as col_86,
         (select string_agg(t.tgtype::text, ',') from pg_trigger t
           where t.tgrelid = 'portal.delivery_requests'::regclass
             and t.tgname = 'trg_notify_delivery_request')                              as trg_86,
         (select count(*) from vessl.companies where name like 'ZZDELIV%')             as zz_companies,
         (select count(*) from vessl.sales_orders where so_number like 'ZZDELIV%')     as zz_sos,
         (select count(*) from vessl.purchase_orders where order_number like 'ZZDELIV%') as zz_pos,
         (select count(*) from vessl.shipments where shipment_number like 'ZZDELIV%')  as zz_ships,
         (select count(*) from portal.users
           where email = '<test login>')                        as signups,
         (select count(*) from portal.users
           where email = '<test login>'
             and status = 'pending' and company_id is null)                             as signups_pending,
         (select coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', '), 'none')
            from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where not t.tgisinternal and t.tgenabled <> 'D'
             and t.tgrelid in ('vessl.companies'::regclass, 'vessl.sales_orders'::regclass,
                               'vessl.purchase_orders'::regclass, 'vessl.sales_order_pos'::regclass,
                               'vessl.shipments'::regclass, 'vessl.shipment_pos'::regclass,
                               'portal.users'::regclass)
             and position('http' in lower(p.prosrc)) > 0)                              as mailing_triggers;

do $guard$
begin
  if (select col_86 from _pre88) <> 1 or (select trg_86 from _pre88) is distinct from '21' then
    raise exception 'script 86 is not live -- column or trigger missing, nothing changed';
  end if;
  if (select zz_companies + zz_sos + zz_pos + zz_ships from _pre88) <> 0 then
    raise exception 'ZZDELIV rows already exist, nothing changed';
  end if;
  if (select signups from _pre88) <> 1 or (select signups_pending from _pre88) <> 1 then
    raise exception 'expected one pending portal signup for +zzdeliv with no company -- do step 0 first, nothing changed';
  end if;
  if (select mailing_triggers from _pre88) <> 'none' then
    raise exception 'a trigger on a touched table may send mail, nothing changed -- %', (select mailing_triggers from _pre88);
  end if;
end
$guard$;

insert into vessl.companies (name, type)
values ('ZZDELIV factory', 'factory');

insert into vessl.companies (name, type, delivery_request_recipients)
values ('ZZDELIV', 'client',
        array['<test login>', 'mattdillon@kinguniversal.com']);

insert into vessl.sales_orders (so_number, client_company_id, client_po_number, order_date, currency, status)
select 'ZZDELIV-SO-001', c.id, 'ZZDELIV-PO-001', current_date, 'USD', 'shipped'
  from vessl.companies c where c.name = 'ZZDELIV' and c.type::text = 'client';

insert into vessl.purchase_orders (factory_company_id, client_company_id, order_number, client_po_number,
                                   order_date, currency, status)
select f.id, c.id, 'ZZDELIV-PO-001', 'ZZDELIV-PO-001', current_date, 'USD', 'shipped'
  from vessl.companies f, vessl.companies c
 where f.name = 'ZZDELIV factory' and f.type::text = 'factory'
   and c.name = 'ZZDELIV' and c.type::text = 'client';

insert into vessl.sales_order_pos (sales_order_id, purchase_order_id)
select so.id, po.id
  from vessl.sales_orders so, vessl.purchase_orders po
 where so.so_number = 'ZZDELIV-SO-001' and po.order_number = 'ZZDELIV-PO-001';

insert into vessl.shipments (shipment_number, client_company_id, status, estimated_departure, estimated_arrival)
select 'ZZDELIV-SH-001', c.id, 'in_transit', now() - interval '7 days', now() + interval '14 days'
  from vessl.companies c where c.name = 'ZZDELIV' and c.type::text = 'client';

insert into vessl.shipment_pos (shipment_id, purchase_order_id)
select sh.id, po.id
  from vessl.shipments sh, vessl.purchase_orders po
 where sh.shipment_number = 'ZZDELIV-SH-001' and po.order_number = 'ZZDELIV-PO-001';

update portal.users u
   set status = 'approved',
       company_id = (select c.id from vessl.companies c where c.name = 'ZZDELIV' and c.type::text = 'client')
 where u.email = '<test login>'
   and u.status = 'pending' and u.company_id is null;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 86 live, no ZZDELIV rows, one pending signup, no mailing trigger' as chk,
         (select col_86::text || '/' || trg_86 || '/' || (zz_companies + zz_sos + zz_pos + zz_ships)::text
                 || '/' || signups_pending::text || '/' || mailing_triggers from _pre88) as got,
         '1/21/0/1/none' as want
  union all
  select 'b1 two ZZDELIV companies, a client and a factory',
         (select string_agg(type::text, ',' order by type::text) from vessl.companies where name like 'ZZDELIV%'),
         'client,factory'
  union all
  -- Identity by length, sorted by length so no collation can reorder them --
  -- mattdillon 28, <test login> 36.
  select 'b2 ZZDELIV extras are the two addresses',
         (select string_agg(length(x)::text, ',' order by length(x)) from vessl.companies c,
                 unnest(c.delivery_request_recipients) x
           where c.name = 'ZZDELIV' and c.type::text = 'client'), '28,36'
  union all
  select 'b3 the sales order reaches exactly one shipment through its PO',
         (select count(*)::text
            from vessl.sales_orders so
            join vessl.sales_order_pos sop on sop.sales_order_id = so.id
            join vessl.shipment_pos shp on shp.purchase_order_id = sop.purchase_order_id
            join vessl.shipments sh on sh.id = shp.shipment_id
           where so.so_number = 'ZZDELIV-SO-001' and sh.shipment_number = 'ZZDELIV-SH-001'), '1'
  union all
  select 'b4 the shipment shows the button -- ETA in the future, no actual arrival',
         (select (estimated_arrival > now())::text || '/' || (actual_arrival is null)::text
            from vessl.shipments where shipment_number = 'ZZDELIV-SH-001'), 'true/true'
  union all
  select 'b5 the order, PO and shipment all belong to the ZZDELIV client',
         (select ((select count(*) from vessl.sales_orders where so_number = 'ZZDELIV-SO-001' and client_company_id = z.id)
                + (select count(*) from vessl.purchase_orders where order_number = 'ZZDELIV-PO-001' and client_company_id = z.id)
                + (select count(*) from vessl.shipments where shipment_number = 'ZZDELIV-SH-001' and client_company_id = z.id))::text
            from vessl.companies z where z.name = 'ZZDELIV' and z.type::text = 'client'),
         '3'
  union all
  select 'b6 the portal user is approved for ZZDELIV',
         (select u.status::text || '/' || (u.company_id = c.id)::text
            from portal.users u, vessl.companies c
           where u.email = '<test login>'
             and c.name = 'ZZDELIV' and c.type::text = 'client'), 'approved/true'
  union all
  select 'b7 no company outside ZZDELIV carries extras -- 87 runs after the test',
         (select count(*)::text from vessl.companies
           where delivery_request_recipients is not null and name not like 'ZZDELIV%'), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
