-- 68 -- two company rows for one factory become one.
--
-- WHAT IT DOES. Archives the UPM company row and its factory preset, re-points
-- the two quotes naming UPM at the full company name, fills the blanks on the
-- kept preset from the UPM preset, deletes the UPM preset, and removes the UPM
-- company row.
--
-- THE TWO ROWS ARE THE SAME FIRM, confirmed by the user. Both are type factory,
-- both carry a upm.hk address, and the shorter name was created on 2026-08-27,
-- seven weeks after the longer one, by somebody typing a name rather than picking
-- the company that already existed.
--
--   9ea6b132-6d75-421a-b770-d9deea39f9f0  Universal Plastic and Metal Manufacturing LTD  KEPT
--   765b2a44-a681-4cff-860c-911fc577fa70  UPM                                            REMOVED
--
-- THE KEPT ROW IS THE ONE WITH THE HISTORY. It carries 3 purchase orders and the
-- only contact. UPM carries nothing -- which is what makes this a duplicate to
-- remove rather than two records to reconcile.
--
-- NOTHING POINTS AT UPM BY KEY, AND THAT WAS MEASURED ACROSS ALL OF THEM. There
-- are 24 foreign key columns referencing vessl.companies, 7 of them in the portal
-- schema, and the UPM id appears in ZERO. The count came from pg_constraint
-- rather than from a list somebody wrote down, because a merge that leaves one
-- orphaned key is a row nobody finds until it errors. b1 re-asserts all 24 at
-- run time, so a reference created between writing and running stops the script
-- rather than being deleted underneath.
--
-- SO THE ONLY LIVE REFERENCES ARE TWO PIECES OF FREE TEXT. quotes.factory is
-- typed by hand and 2 rows hold UPM. Two OTHER quotes already carry the full
-- name and are deliberately not touched -- they are already correct, and an
-- update matching them would be an update that changes nothing while looking
-- like it changed something.
--
-- THE COMPANY MERGE IS A NO-OP AND SAYS SO. Every column that could be filled on
-- the kept row -- phone, website, vendor_number, pallet_info, po_notes, and both
-- addresses -- is null on BOTH rows. The only populated field is email, and the
-- kept row already has one, so the never-overwrite rule leaves it alone. There is
-- no UPDATE on companies in this script because there is nothing for it to do.
--
-- WHAT THAT COSTS, STATED RATHER THAN HIDDEN. Crystal.zhang@upm.hk is on the UPM
-- company row and on the UPM preset. The kept row and the kept preset both hold
-- dp4@upm.hk, which is non-null, so the never-overwrite rule drops the Crystal
-- address from both. It was measured to exist nowhere else in structured data --
-- no contact row holds it -- so after this it survives in the archive below and
-- on the factory_email of two quotes. If it is the address people actually use,
-- that is a separate decision and a separate script.
--
-- THE PRESET MERGE IS WHERE DATA REALLY MOVES. The kept preset gains contact,
-- country and lead time from the UPM preset, which are three things the kept row
-- never had. Its own email stays.
--
-- MEASURED BEFORE WRITING, against the live database
--   companies -- exactly 2 rows match the two names, both type factory.
--   UPM id -- 0 references across all 24 FK columns, 0 purchase orders, 0 contacts.
--   kept id -- 3 purchase orders, 1 contact (Crystal, dp4@upm.hk, primary).
--   quotes.factory = UPM -- 2 rows; 2 further quotes already hold the full name.
--   factory_presets -- 1 row per name, no FK points at the table, no triggers.
--   sales_orders -- has no factory column at all, only client_company_id.
--   companies_name_type_key is UNIQUE (name, type); factory_presets has only a PK.

begin;

-- ARCHIVE FIRST, before anything is changed. Both rows as they stand, as JSON, so
-- the removed record is recoverable from this transcript alone.
create temp table _arch68 on commit drop as
  select (select to_jsonb(c) from vessl.companies c
           where c.id = '765b2a44-a681-4cff-860c-911fc577fa70')          as upm_company,
         (select to_jsonb(f) from vessl.factory_presets f
           where lower(btrim(f.factory)) = 'upm')                        as upm_preset,
         (select to_jsonb(c) from vessl.companies c
           where c.id = '9ea6b132-6d75-421a-b770-d9deea39f9f0')          as kept_company_before,
         (select to_jsonb(f) from vessl.factory_presets f
           where lower(btrim(f.factory)) = 'universal plastic and metal manufacturing ltd')
                                                                         as kept_preset_before;

select jsonb_pretty(upm_company)        as archived_upm_company,
       jsonb_pretty(upm_preset)         as archived_upm_preset,
       jsonb_pretty(kept_company_before) as kept_company_before,
       jsonb_pretty(kept_preset_before)  as kept_preset_before
  from _arch68;

-- PRE-STATE, counted before anything is written.
create temp table _pre68 on commit drop as
  select (select count(*) from vessl.companies
           where type::text = 'factory'
             and lower(btrim(name)) in ('upm','universal plastic and metal manufacturing ltd'))  as matched_companies,
         (select count(*) from vessl.purchase_orders
           where factory_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')                    as upm_pos,
         (select count(*) from vessl.purchase_orders
           where factory_company_id = '9ea6b132-6d75-421a-b770-d9deea39f9f0')                    as kept_pos,
         (select count(*) from vessl.contacts
           where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')                            as upm_contacts,
         (select count(*) from vessl.contacts
           where company_id = '9ea6b132-6d75-421a-b770-d9deea39f9f0')                            as kept_contacts,
         (select count(*) from vessl.quotes where lower(btrim(factory)) = 'upm')                 as quotes_short,
         (select count(*) from vessl.quotes
           where lower(btrim(factory)) = 'universal plastic and metal manufacturing ltd')        as quotes_full,
         (select count(*) from vessl.companies)                                                  as companies_before,
         (select count(*) from vessl.factory_presets)                                            as presets_before,
         (select count(*) from vessl.quotes)                                                     as quotes_before;

-- REFUSE rather than merge a pair that is not the pair measured.
do $guard$
begin
  if (select matched_companies from _pre68) <> 2 then
    raise exception 'the two company rows are not both present, nothing changed';
  end if;
  -- THE ROW BEING REMOVED MUST HAVE NO HISTORY. A purchase order would make this
  -- a reconciliation rather than a duplicate removal, and the FK is ON DELETE
  -- RESTRICT, so the delete would fail anyway -- but it should fail here, with a
  -- sentence, rather than as a constraint violation.
  if (select upm_pos from _pre68) <> 0 then
    raise exception 'UPM carries purchase orders, so it is not a duplicate with no history, nothing changed';
  end if;
  if (select kept_pos from _pre68) <> 3 then
    raise exception 'the kept company no longer carries the three purchase orders measured, nothing changed';
  end if;
  if (select quotes_short from _pre68) <> 2 then
    raise exception 'the number of quotes naming UPM is not the two measured, nothing changed';
  end if;
end
$guard$;

-- 1. THE TWO QUOTES, RE-POINTED. Matched on the trimmed lowercase value, because
--    free text carries whatever somebody typed. factory_contact and factory_email
--    are deliberately left alone -- Crystal quoted these and that is a true record
--    of who, which the company name being corrected does not change.
update vessl.quotes
   set factory = 'Universal Plastic and Metal Manufacturing LTD',
       updated_at = now()
 where lower(btrim(factory)) = 'upm';

-- 2. THE PRESET, FILLED FROM THE ONE BEING REMOVED. coalesce in this order means
--    the kept value wins wherever it has one, so this can only fill blanks.
update vessl.factory_presets k
   set factory_contact = coalesce(k.factory_contact, u.factory_contact),
       factory_email   = coalesce(k.factory_email,   u.factory_email),
       factory_phone   = coalesce(k.factory_phone,   u.factory_phone),
       country         = coalesce(k.country,         u.country),
       lead_time       = coalesce(k.lead_time,       u.lead_time),
       hts             = coalesce(k.hts,             u.hts)
  from vessl.factory_presets u
 where lower(btrim(k.factory)) = 'universal plastic and metal manufacturing ltd'
   and lower(btrim(u.factory)) = 'upm';

-- 3. The preset that has been merged away.
delete from vessl.factory_presets where lower(btrim(factory)) = 'upm';

-- 4. NO UPDATE ON companies, and that is the finding rather than an omission --
--    see the header. Every fillable column is null on both rows.

-- 5. The duplicate company row. Nothing points at it by key, measured across all
--    24 FK columns above and re-asserted in b1 below.
delete from vessl.companies where id = '765b2a44-a681-4cff-860c-911fc577fa70';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 two company rows matched, UPM with no orders' as chk,
         (select matched_companies::text || '/' || upm_pos::text from _pre68) as got, '2/0' as want
  union all
  select 'a1 two quotes said UPM and two already said the full name',
         (select quotes_short::text || '/' || quotes_full::text from _pre68), '2/2'
  union all
  select 'a2 UPM had no contacts and the kept row had one',
         (select upm_contacts::text || '/' || kept_contacts::text from _pre68), '0/1'
  union all
  -- THE ARCHIVE IS PART OF THE PASS. A merge whose archive did not capture the
  -- removed row is a merge with no way back.
  select 'a3 the removed row and its preset were archived',
         (select (case when upm_company is not null and upm_preset is not null then 'both' else 'missing' end)::text
            from _arch68), 'both'
  union all
  -- ALL 24 FK COLUMNS, RE-ASSERTED AT RUN TIME. Written out rather than counted
  -- from a loop, because the point is that every one of them was named.
  select 'b1 no key anywhere points at the removed id',
         ((select count(*) from portal.client_tasks       where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.delivery_requests  where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.messages           where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.notifications      where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.order_notes        where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.threads            where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from portal.users              where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.addresses           where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.company_container_watchlist where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.contacts            where company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.containers          where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.freight_invoices    where forwarder_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.materials           where supplier_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.products            where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.programs            where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.purchase_orders     where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.purchase_orders     where factory_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.quotes              where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.sales_orders        where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.shipment_quotes     where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.shipment_quotes     where forwarder_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.shipments           where carrier_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.shipments           where client_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
        + (select count(*) from vessl.shipments           where freight_forwarder_company_id = '765b2a44-a681-4cff-860c-911fc577fa70')
         )::text, '0'
  union all
  select 'b2 no quote names UPM any more',
         (select count(*)::text from vessl.quotes where lower(btrim(factory)) = 'upm'), '0'
  union all
  select 'b3 four quotes now name the company in full',
         (select count(*)::text from vessl.quotes
           where lower(btrim(factory)) = 'universal plastic and metal manufacturing ltd'), '4'
  union all
  select 'b4 the kept preset gained contact, country and lead time',
         (select coalesce(factory_contact,'-') || '/' || coalesce(country,'-') || '/' || coalesce(lead_time,'-')
            from vessl.factory_presets
           where lower(btrim(factory)) = 'universal plastic and metal manufacturing ltd'), 'Crystal/China/45-50'
  union all
  -- THE NEVER-OVERWRITE RULE, PROVED rather than trusted. The kept email was set
  -- before this ran and has to be the same address after it.
  -- The cast is what keeps this branch the same type as every other one. A bare
  -- coalesce on a text column is text already at run time, but the UNION is where
  -- a mismatch takes down the whole statement rather than one branch, so every
  -- got carries its own cast and none of them relies on being obviously right.
  select 'b5 the kept preset email was not overwritten',
         (select coalesce(factory_email,'(null)')::text from vessl.factory_presets
           where lower(btrim(factory)) = 'universal plastic and metal manufacturing ltd'), 'dp4@upm.hk'
  union all
  select 'b6 the UPM preset is gone and one preset remains for this factory',
         (select count(*)::text from vessl.factory_presets where lower(btrim(factory)) = 'upm') || '/' ||
         (select count(*)::text from vessl.factory_presets
           where lower(btrim(factory)) = 'universal plastic and metal manufacturing ltd'), '0/1'
  union all
  select 'b7 the UPM company row is gone',
         (select count(*)::text from vessl.companies
           where id = '765b2a44-a681-4cff-860c-911fc577fa70'), '0'
  union all
  select 'b8 the kept company is untouched, email included',
         (select name || ' ' || coalesce(email,'(null)') from vessl.companies
           where id = '9ea6b132-6d75-421a-b770-d9deea39f9f0'),
         'Universal Plastic and Metal Manufacturing LTD dp4@upm.hk'
  union all
  select 'b9 the kept company keeps its three orders and its contact',
         (select count(*)::text from vessl.purchase_orders
           where factory_company_id = '9ea6b132-6d75-421a-b770-d9deea39f9f0') || '/' ||
         (select count(*)::text from vessl.contacts
           where company_id = '9ea6b132-6d75-421a-b770-d9deea39f9f0'), '3/1'
  union all
  select 'b10 exactly one factory company answers to this firm now',
         (select count(*)::text from vessl.companies
           where type::text = 'factory'
             and lower(btrim(name)) in ('upm','universal plastic and metal manufacturing ltd')), '1'
  union all
  select 'c1 one company and one preset left, and no quote was added or lost',
         (select ((select count(*) from vessl.companies)       - companies_before)::text || '/' ||
                 ((select count(*) from vessl.factory_presets) - presets_before)::text || '/' ||
                 ((select count(*) from vessl.quotes)          - quotes_before)::text
            from _pre68), '-1/-1/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
