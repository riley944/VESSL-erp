-- 61 -- the duplicate TRE-011 quote, removed.
--
-- WHAT HAPPENED. Saving the TRE-011 quote inserted two rows 1.5 seconds apart.
-- The first, 7c976a19, is the real one and carries both links, product 877c38f2
-- and company ee8455ed. The second, 8b6eb449, is a shell. Same sku, same product
-- text, same client text, same single tier at 2000 units and 10 landed, but
-- product_id and client_company_id are both NULL, because the linking steps that
-- follow a save ran against the first row and never against this one.
--
-- Loren asked for the shell to go. One row, by id, or nothing.
--
-- NOTHING REFERENCES IT, measured rather than assumed. There is no foreign key
-- anywhere in this database pointing at vessl.quotes or public.quotes, so every
-- reference is by convention and each one was counted by hand. All twelve read
-- zero, and _r61 below counts them again inside the transaction so the guard and
-- the checks read the same numbers rather than trusting yesterday.
--
-- programs and program_notes are both empty and neither carries a quote column,
-- so there is no card and no note to orphan.
--
-- THE ARCHIVE holds the row as it stood, every column, in
-- archive/2026-09-18-duplicate-quote-TRE-011.json, beside a summary of the row
-- being kept and the twelve reference counts.
--
-- NO TIMESTAMP LITERAL APPEARS BELOW. A timestamp carries single colons and the
-- SQL editor rewrites those as bind parameters, which is what cost script 58 a
-- rehearsal. The guard that proves nobody has edited this row since it was
-- created reads updated_at < created_at instead. That is true of it today, and it
-- becomes false the moment anybody saves the row, because a save stamps
-- updated_at with the current time.
--
-- COUNTS ARE ASSERTED AS DIFFERENCES, NOT ABSOLUTES. quotes moved from 338 to 339
-- while this was being written. An absolute want would fail a perfectly good run
-- for a reason that has nothing to do with this script.
--
-- MEASURED BEFORE WRITING, against the live database
--   339 quotes, 2 with sku TRE-011, 12 for Tremont Sporting Co.
--   8b6eb449, product_id NULL, client_company_id NULL, sku length 7, client
--   length 19, one tier, updated_at earlier than created_at by 2.59 seconds,
--   which is the largest such gap in the table.
--   7c976a19, product_id 877c38f2, client_company_id ee8455ed, one tier.
--   0 programs, 0 program_notes, 0 references from every path named above.

begin;

-- PRE-STATE FIRST, counted before the delete, so c1 and c2 measure this script
-- rather than reporting what it just did.
create temp table _pre61 on commit drop as
  select (select count(*) from vessl.quotes)                                       as quotes_before,
         (select count(*) from vessl.quotes where sku = 'TRE-011')                  as tre011_before,
         (select count(*) from vessl.quotes where client = 'Tremont Sporting Co')   as tremont_before,
         (select count(*) from vessl.programs)                                      as programs_before,
         (select count(*) from vessl.program_notes)                                 as notes_before;

-- THE TARGET, snapshotted by id before anything is written. Identity is the id
-- plus lengths, never the free text, because only those survive being pasted.
create temp table _t61 on commit drop as
  select q.id,
         length(q.sku)                     as sku_len,
         length(q.client)                  as client_len,
         q.product_id,
         q.client_company_id,
         (q.updated_at < q.created_at)     as never_edited,
         jsonb_array_length(q.tiers)       as tier_count
    from vessl.quotes q
   where q.id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid;

-- EVERY REFERENCE PATH, re-counted here rather than taken on trust.
create temp table _r61 (path text, hits bigint) on commit drop;
insert into _r61
  select 'sales_orders.source_quote_id', count(*) from vessl.sales_orders
   where source_quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'sales_order_items.quote_id', count(*) from vessl.sales_order_items
   where quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'purchase_orders.source_quote_id', count(*) from vessl.purchase_orders
   where source_quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'vessl.tasks.quote_id', count(*) from vessl.tasks
   where quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'public.tasks.quote_id', count(*) from public.tasks
   where quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'forwarder_bids.shipment_quote_id', count(*) from vessl.forwarder_bids
   where shipment_quote_id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
  union all
  select 'vessl.tasks.quote_label', count(*) from vessl.tasks
   where quote_label like '%8b6eb449%' or quote_label like '%TRE-011%'
  union all
  select 'public.tasks.quote_label', count(*) from public.tasks
   where quote_label like '%8b6eb449%' or quote_label like '%TRE-011%'
  union all
  select 'forwarder_bids.quote_number', count(*) from vessl.forwarder_bids
   where quote_number like '%8b6eb449%'
  union all
  select 'shipment_quotes.quote_number', count(*) from vessl.shipment_quotes
   where quote_number like '%8b6eb449%'
  union all
  select 'programs rows', count(*) from vessl.programs
  union all
  select 'program_notes mentioning it', count(*) from vessl.program_notes
   where note like '%8b6eb449%' or note like '%TRE-011%';

-- REFUSE rather than delete a row that is not the one measured.
do $guard$
begin
  if (select count(*) from _t61) <> 1 then
    raise exception 'the target row is not there, nothing changed';
  end if;
  if (select count(*) from _t61 where product_id is null and client_company_id is null) <> 1 then
    raise exception 'the target row has been linked since it was measured, nothing changed';
  end if;
  if (select count(*) from _t61 where never_edited) <> 1 then
    raise exception 'the target row has been edited since it was created, nothing changed';
  end if;
  if (select count(*) from _t61 where sku_len = 7 and client_len = 19 and tier_count = 1) <> 1 then
    raise exception 'the target row does not match the measured shape, nothing changed';
  end if;
  if (select coalesce(sum(hits), 0) from _r61) <> 0 then
    raise exception 'something references the target row now, nothing changed';
  end if;
  if (select count(*) from vessl.quotes
       where id = '7c976a19-e657-4ddc-96d3-0d82223215c8'::uuid
         and product_id = '877c38f2-74e5-4a21-be8d-a75286a6ef69'::uuid
         and client_company_id = 'ee8455ed-520f-4a39-93cc-10d3e634915f'::uuid) <> 1 then
    raise exception 'the surviving row is not the one measured, nothing changed';
  end if;
end
$guard$;

-- ONE ROW, BY ID, and only while it is still the shell that was measured. The
-- two null tests repeat the guard on purpose, so the delete itself cannot touch a
-- row that acquired links between the guard and this statement.
delete from vessl.quotes q
 where q.id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid
   and q.product_id is null
   and q.client_company_id is null;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the shell row was there, with both links unset' as chk,
         (select count(*)::text from _t61
           where product_id is null and client_company_id is null) as got,
         '1' as want
  union all
  select 'a1 nothing referenced it, across all twelve paths',
         (select coalesce(sum(hits), 0)::text from _r61), '0'
  union all
  select 'a2 two rows carried sku TRE-011 before',
         (select tre011_before::text from _pre61), '2'
  union all
  select 'a3 the shell had never been edited since it was created',
         (select count(*)::text from _t61 where never_edited), '1'
  union all
  select 'b1 the shell row is gone',
         (select count(*)::text from vessl.quotes
           where id = '8b6eb449-e23d-41bd-86df-76676f2b5006'::uuid), '0'
  union all
  select 'b2 the surviving row is still there with both links',
         (select count(*)::text from vessl.quotes
           where id = '7c976a19-e657-4ddc-96d3-0d82223215c8'::uuid
             and product_id = '877c38f2-74e5-4a21-be8d-a75286a6ef69'::uuid
             and client_company_id = 'ee8455ed-520f-4a39-93cc-10d3e634915f'::uuid), '1'
  union all
  select 'b3 the surviving row still carries its one tier',
         (select jsonb_array_length(tiers)::text from vessl.quotes
           where id = '7c976a19-e657-4ddc-96d3-0d82223215c8'::uuid), '1'
  union all
  select 'b4 one row now carries sku TRE-011',
         (select count(*)::text from vessl.quotes where sku = 'TRE-011'), '1'
  union all
  -- DIFFERENCES, not absolutes. Somebody saving an unrelated quote while this
  -- sits unrun must not fail it.
  select 'c1 quotes down by exactly one',
         (select ((select quotes_before from _pre61)
                - (select count(*) from vessl.quotes))::text), '1'
  union all
  select 'c2 Tremont quotes down by exactly one',
         (select ((select tremont_before from _pre61)
                - (select count(*) from vessl.quotes where client = 'Tremont Sporting Co'))::text), '1'
  union all
  -- The product and the company the surviving row points at are not this script
  -- business, and neither is touched.
  select 'c3 the product and the company are both still there',
         (select (select count(*) from vessl.products
                   where id = '877c38f2-74e5-4a21-be8d-a75286a6ef69'::uuid)::text
              || '/' ||
                 (select count(*) from vessl.companies
                   where id = 'ee8455ed-520f-4a39-93cc-10d3e634915f'::uuid)::text), '1/1'
  union all
  select 'c4 programs and program notes are untouched',
         (select ((select count(*) from vessl.programs) - (select programs_before from _pre61))::text
              || '/' ||
                 ((select count(*) from vessl.program_notes) - (select notes_before from _pre61))::text), '0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
