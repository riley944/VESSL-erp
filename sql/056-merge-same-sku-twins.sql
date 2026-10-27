-- 56 -- merge script A. Same-SKU twins, LL1-380 excluded.
--
-- 55 is reserved for dropping p_program_ids from rename_product_sku, which runs
-- tomorrow. This takes the next number so every number stays unique, and it does
-- not depend on 55 in either order.
--
-- ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
-- 23 retired product rows share their SKU exactly with a live row, the survivor,
-- and each carries one PLM program for a client the survivor already has a
-- program for. PLM counts both. 18 are the BG-101, BG-104 and BG-113 size rows
-- whose PO-carrying twins script 52 made active. The rest are JON-106, two
-- LL1-1591 rows and two LL1-1629 rows.
--
-- Each of the 23 old rows holds exactly one quote, for that client, and nothing
-- else -- no purchase order line, no sales order line, no other program, no
-- program note. So the merge is one pointer and one delete per row.
--   1. the quote is re-linked to the survivor product
--   2. the old program, now empty, is deleted
-- The old product rows stay, retired and empty. Removing them is not part of
-- this script.
--
-- LL1-380 is excluded. Its two retired rows carry purchase order lines and are
-- sizes of the live row, which makes them script B and the sizes decision.
--
-- ── DELIBERATELY NOT CHANGED ────────────────────────────────────────────────
-- quotes.updated_at is left alone. Re-linking corrects a pointer and edits
-- nothing in the quote, and bumping it would make 23 old quotes read as updated
-- today on the Quotes client cards. The quote text columns, sku and product
-- name, stay as they were entered. The app resolves a quote by product_id first.
--
-- ── IDENTITY ────────────────────────────────────────────────────────────────
-- Every row below is named by id, never by text. Before any write the guard
-- re-proves each pair against the live data, and the script refuses the whole
-- batch if a single pair no longer holds.
--
-- ── ARCHIVE ─────────────────────────────────────────────────────────────────
-- archive/2026-09-15-plm-same-sku-twins-merge.json holds every program, quote,
-- product row and line involved, exported before this script was written.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- Board under the product-level rule reads 89 pipeline, 194 archived, 52
-- retired. All 23 old programs are retired, so the board should read 89 / 194 /
-- 29 after. No trigger on quotes. quotes has no unique index beyond its key, so
-- a second quote on the survivor collides with nothing. program_notes cascades
-- from programs and holds no rows for these 23.

begin;

create temp table _pairs56 (
  old_program_id  uuid not null,
  old_product_id  uuid not null,
  surv_product_id uuid not null,
  surv_program_id uuid not null,
  quote_id        uuid not null
) on commit drop;

insert into _pairs56 values
  ('022be5d0-6830-4bed-8daf-fc7bae7085e3', 'ad6c1a9a-a060-475d-83bd-64149433e9ad', 'd5d44a42-2f92-4748-97d0-7911f7d2fb80', 'f75357b4-b951-4d1e-9592-a7063ee41665', '9160f7ba-6998-46d4-aa74-87c8256e2ad2'),  -- BG-101-2XL
  ('fecfe96f-dc43-4748-86ef-90cdb1745185', '08e2ba3d-6a79-40de-9fba-adf7e93b5575', '9c6ee5d8-0df1-4b1f-9894-0b9d83a40330', '578fcd49-5da1-4b5c-91f2-93d380955420', '5050a6cf-da82-43c6-87fc-2c16db580f87'),  -- BG-101-3XL
  ('02b9b2ff-4b71-454d-a09a-e171c593433b', 'c344309a-4e2e-45a6-8d49-d98b254b6547', '1efba198-2d7d-45e0-9735-f98d3282f75b', '53753cd2-4934-471e-b187-ebfe961173ed', 'd60d192e-d752-4ed6-a769-2208fe7abed0'),  -- BG-101-L
  ('c51cf8bc-926d-463e-bb2c-fa21ed00e710', 'f7985bd8-097f-4bfb-8938-932b47c7730f', '56eb2269-0750-4945-9231-5285f6e3ad8c', 'bac77420-a219-4199-81f4-d81ee52ebc2f', '83f5cf40-4704-4d8a-9ab9-6e9cb93040ca'),  -- BG-101-M
  ('aead575c-19f9-4fb0-87d7-32b88f541d92', 'f6ff9b74-43a1-4288-aaf8-0fb4ac2b8b44', '533b4bed-5b98-4241-bd12-d7afd29e182d', 'cdc8388f-b05a-4caf-8baa-cee3efb67350', '9b5cf857-7aa8-430a-91f7-add1ff844a8d'),  -- BG-101-S
  ('2740032e-c1a3-4e43-b2e1-417d4953f5dc', '2a89e988-1efb-4ab7-bb96-8ccdd23337de', 'dbe8e840-e3d3-4e86-829f-be1b7176ed42', '5a119045-45c2-416d-8c73-744940a1ce87', 'bdc00a08-94dd-437d-b579-227c0b03d155'),  -- BG-101-XL
  ('058258cb-8e93-4c28-b1ec-c37602216e3e', 'dee56f07-e702-4cd0-84c9-0d8727b0682c', 'f160f8f7-5daa-4ae8-aa53-0d67f4eb2371', '38c6c133-d918-4afa-adb0-02111916a15b', '3ff616ab-3830-4459-8c54-32213fa1f755'),  -- BG-104-2XL
  ('b02854a4-f067-476b-bc92-5c090d2050a3', '73f01a18-6953-4700-81aa-da68f14f6981', 'd9367d86-3788-406a-8123-dfefebd9f59f', 'aea4fac3-6fc7-48c8-bfcf-a4da0112a90c', 'd3c63f5d-7e65-434f-93c8-0e27499648de'),  -- BG-104-3XL
  ('ac116f77-69c3-4efb-bd40-a7eb12651087', '8b0ad198-4ed3-423b-9098-4ba83685f384', '0201841f-7ad3-4da6-9ad8-d185f01d7225', 'b3ac6d41-0245-47d6-a326-244f5f2ca5f9', '25776c43-8f82-444a-9a1d-92fe92a5581c'),  -- BG-104-L
  ('7d2a6c27-b154-4cb1-9d3f-461335893ad0', '35926ea7-a9c2-46f2-a5b5-bbf295bca74f', 'd87f0977-3d4a-4515-bc08-faa565f3cae1', '8ca8fb1f-0a97-4dfd-a386-2fdbfe6174e8', 'e38cd4f0-9df2-4cf6-95f4-b39e90c76a66'),  -- BG-104-M
  ('f5988074-9dcf-47b0-b812-39f692df9a66', 'a098db07-f068-4e8b-8871-b74ef4f1f244', '59a7c385-988e-470d-9265-c0878aadaef5', '5cd9dfd0-f1fb-4283-b109-701118184f13', 'dfbd46d7-07db-4526-96ca-146511900269'),  -- BG-104-S
  ('51643933-024a-4f9e-a653-d248653fc890', '064918f6-e925-4fea-b170-f957dc3bf35b', '9ef11389-b2a0-4bdd-a803-dd40d3077ad6', '6d736c25-8c6f-42d0-af9a-92ccf97d80fb', '7fa36235-af49-491a-94be-38f410bad085'),  -- BG-104-XL
  ('f570e715-60d7-4699-8d65-93bb5c681245', 'd502bff4-0c97-4b1c-a5af-f88be8adfea5', 'f03148c1-50a1-442f-8d1d-1c9782e0004a', 'b9941550-eb72-4a64-9e07-8b6dac41e223', '9af9fbdb-df9d-4795-a558-61eb2695b518'),  -- BG-113-2XL
  ('b9bd51e4-bca1-4c22-a7e4-6bc75cbe0f89', '4d7b5f54-8964-4f46-b41f-f8c6bf90879c', '41e86f70-ea1a-435a-9cbd-6e5e1e18ab98', '33c687f3-514c-410f-9532-eb870346d5c6', 'f76cdb83-08a6-400f-955c-41b00ef04cd8'),  -- BG-113-3XL
  ('e628d830-92e4-466c-b516-60c0675451c2', '33a6a7ad-7a35-4525-922e-860bfb6bd060', 'ae183834-6b23-4eaf-8a6e-eedbf759d414', '771b20df-ae2d-4f76-a0dd-fa86ded62278', '11822119-90ec-41d3-9afc-4dae607d1396'),  -- BG-113-L
  ('d8c5c2b3-18d4-401f-8cb3-716e3c4ad2eb', 'ab432389-2e31-4beb-a654-5204598c0b1f', 'f64cc4b4-c1bd-4598-9ba7-fea546441d36', '471be071-7cd0-413f-9422-2cc39ee76d50', '91428a4f-304d-4511-99d3-a54ccba12abc'),  -- BG-113-M
  ('7bcc315e-f2dd-41aa-9b3c-f5bf8082c22b', '997db3e8-bbdd-405a-a899-ce5c5bc95f5e', 'f3301e2b-1310-4a06-a75c-9762b381f693', '0754fdd1-dc65-4162-987f-9e65073edf7a', 'e82d91b3-5615-4266-a47a-71175bf1ae41'),  -- BG-113-S
  ('db6b66f3-0da6-4d43-b721-6cb454443740', 'bbdbd21a-15ef-4260-96f5-a4ddb7ff925d', '29d17658-655b-4600-837b-1990764fb8fd', '685ae6e7-30cf-46d6-bf77-04b7bf19da6d', 'd148434e-23e6-4aa7-8946-a0a750c7a46b'),  -- BG-113-XL
  ('07ed038e-2bc5-41fc-97e3-8ba2c6f8231d', '61d55187-749d-46b1-9d39-b2f2d3245ea1', '138427ce-e743-441f-9f82-850ffe0f69a7', '451a4f96-ea39-4df8-a6ca-95d2fcf6efb9', '95cedb4c-150e-4126-8f37-7ed67985a740'),  -- JON-106
  ('5bbc1719-7138-45cb-b2c4-df4e4c191dcf', '2edeaee1-24ab-4dbd-80de-686d0de42701', '5c66a187-0c91-4b0c-8cdb-158c03f5bb6a', 'f91af4c1-4207-4e05-96b1-570653407234', '144df4bf-8ebf-44ad-9488-67405fee67c9'),  -- LL1-1591 Ollie
  ('0eb0bfda-4e96-4127-ad02-a084d4040b9b', '76a937c9-87c1-437f-b839-8e64fba52e77', '5c66a187-0c91-4b0c-8cdb-158c03f5bb6a', 'f91af4c1-4207-4e05-96b1-570653407234', 'aba5fc33-1dd1-4df2-a58a-6e4c55104e23'),  -- LL1-1591 youth steel
  ('851f3061-dfe1-47a5-b59d-739c8f2b6acf', 'fc2fcc79-bdf0-4fc7-b3c7-4c44ff31fd21', '8003989b-99c2-4e66-9a2c-1f788e217b98', '0f6a84cf-74da-4cb6-bf89-a5cb5a94dc72', '49f41da4-2bcb-42fa-9f1d-d3959d8bc316'),  -- LL1-1629 small
  ('768d586e-3b89-4ce4-973b-20f65cedfa2c', 'c291bdd2-c3fe-46a3-8416-3b2f41410a0f', '8003989b-99c2-4e66-9a2c-1f788e217b98', '0f6a84cf-74da-4cb6-bf89-a5cb5a94dc72', 'afffc20e-5751-4d48-9721-02fdc0dde5b1');  -- LL1-1629 XL

create temp table _pre56 on commit drop as
  select (select count(*) from _pairs56)                           as pairs,
         (select count(distinct quote_id) from _pairs56)           as distinct_quotes,
         (select count(distinct old_program_id) from _pairs56)     as distinct_old_programs,
         (select count(distinct old_product_id) from _pairs56)     as distinct_old_products,
         (select count(distinct surv_program_id) from _pairs56)    as distinct_surv_programs,
         -- EVERY PAIR RE-PROVEN against the live rows, by id, raw values only.
         (select count(*)
            from _pairs56 x
            join vessl.products o  on o.id  = x.old_product_id
            join vessl.products s  on s.id  = x.surv_product_id
            join vessl.programs op on op.id = x.old_program_id
            join vessl.programs sp on sp.id = x.surv_program_id
            join vessl.quotes q    on q.id  = x.quote_id
           where o.active is false
             and s.active is not false
             and o.sku = s.sku
             and length(o.sku) = length(s.sku)
             and op.product_id = x.old_product_id
             and sp.product_id = x.surv_product_id
             and sp.client_company_id = op.client_company_id
             and q.product_id = x.old_product_id
             and q.client_company_id = op.client_company_id
             and (select count(*) from vessl.quotes q2 where q2.product_id = x.old_product_id) = 1
             and (select count(*) from vessl.programs p2 where p2.product_id = x.old_product_id) = 1
             and not exists (select 1 from vessl.purchase_order_items l where l.product_id = x.old_product_id)
             and not exists (select 1 from vessl.sales_order_items l where l.product_id = x.old_product_id)
             and not exists (select 1 from vessl.program_notes n where n.program_id = x.old_program_id)) as pairs_valid,
         (select count(*) from vessl.quotes)               as quotes_before,
         (select count(*) from vessl.purchase_order_items) as poi_before,
         (select count(*) from vessl.sales_order_items)    as soi_before,
         (select count(*) from vessl.products)             as products_before,
         (select count(*) from vessl.programs)             as programs_before,
         (select md5(string_agg(q.id::text || '|' || coalesce(q.product_id::text, 'null') || '|'
                                || coalesce(q.client_company_id::text, 'null') || '|'
                                || coalesce(q.updated_at::text, 'null'), ',' order by q.id))
            from vessl.quotes q
           where q.id not in (select quote_id from _pairs56)) as other_quotes_stamp,
         (select md5(string_agg(q.id::text || '|' || coalesce(q.client_company_id::text, 'null') || '|'
                                || coalesce(q.sku, 'null') || '|' || coalesce(q.product, 'null') || '|'
                                || coalesce(q.updated_at::text, 'null'), ',' order by q.id))
            from vessl.quotes q
           where q.id in (select quote_id from _pairs56)) as moved_quotes_stamp,
         -- THE BOARD, under the product-level rule now live in PLM. A program is
         -- complete when its product has any purchase order or sales order line.
         (select count(*) filter (where not b.done and b.active is not false)::text || '/'
                 || count(*) filter (where b.done)::text || '/'
                 || count(*) filter (where not b.done and b.active is false)::text
            from (select p.active,
                         (exists (select 1 from vessl.purchase_order_items l where l.product_id = pr.product_id)
                          or exists (select 1 from vessl.sales_order_items l where l.product_id = pr.product_id)) as done
                    from vessl.programs pr join vessl.products p on p.id = pr.product_id) b) as board_before;

-- REFUSE THE WHOLE BATCH if a single pair no longer matches.
do $guard$
begin
  if (select pairs from _pre56) <> 23
     or (select pairs_valid from _pre56) <> 23
     or (select distinct_quotes from _pre56) <> 23
     or (select distinct_old_programs from _pre56) <> 23
     or (select distinct_old_products from _pre56) <> 23 then
    raise exception 'a pair no longer matches the live data, nothing merged';
  end if;
end
$guard$;

-- 1. The quote follows its product. Guarded on the old pointer, so a quote that
--    moved since the guard ran is left as it is.
update vessl.quotes q
   set product_id = x.surv_product_id
  from _pairs56 x
 where q.id = x.quote_id
   and q.product_id = x.old_product_id;

-- 2. The old program goes, but only once nothing points at its product.
delete from vessl.programs pr
 using _pairs56 x
 where pr.id = x.old_program_id
   and pr.product_id = x.old_product_id
   and not exists (select 1 from vessl.quotes q where q.product_id = pr.product_id)
   and not exists (select 1 from vessl.purchase_order_items l where l.product_id = pr.product_id)
   and not exists (select 1 from vessl.sales_order_items l where l.product_id = pr.product_id);

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 23 pairs were named' as chk,
         (select pairs::text from _pre56) as got, '23' as want
  union all
  select 'a1 and every pair held against the live data before any write',
         (select pairs_valid::text from _pre56), '23'
  union all
  select 'a2 the board read 89 pipeline, 194 archived, 52 retired before',
         (select board_before::text from _pre56), '89/194/52'
  union all
  select 'b1 exactly 23 quotes now point at their survivor',
         (select count(*)::text from _pairs56 x join vessl.quotes q on q.id = x.quote_id
           where q.product_id = x.surv_product_id), '23'
  union all
  select 'b2 no quote points at an old product',
         (select count(*)::text from vessl.quotes q
           where q.product_id in (select old_product_id from _pairs56)), '0'
  union all
  select 'b3 all 23 old programs are gone',
         (select count(*)::text from vessl.programs p
           where p.id in (select old_program_id from _pairs56)), '0'
  union all
  select 'b4 every survivor program is still there',
         (select (count(*) = (select distinct_surv_programs from _pre56))::text from vessl.programs p
           where p.id in (select surv_program_id from _pairs56)), 'true'
  union all
  -- ONLY THE POINTER MOVED on the 23. Client, SKU text, name and updated_at are
  -- exactly as they were.
  select 'b5 the moved quotes kept their client, text and updated_at',
         (select (md5(string_agg(q.id::text || '|' || coalesce(q.client_company_id::text, 'null') || '|'
                                 || coalesce(q.sku, 'null') || '|' || coalesce(q.product, 'null') || '|'
                                 || coalesce(q.updated_at::text, 'null'), ',' order by q.id))
                  = (select moved_quotes_stamp from _pre56))::text
            from vessl.quotes q where q.id in (select quote_id from _pairs56)), 'true'
  union all
  -- NO OTHER QUOTE CHANGED at all, pointer, client or stamp.
  select 'b6 every other quote is untouched',
         (select (md5(string_agg(q.id::text || '|' || coalesce(q.product_id::text, 'null') || '|'
                                 || coalesce(q.client_company_id::text, 'null') || '|'
                                 || coalesce(q.updated_at::text, 'null'), ',' order by q.id))
                  = (select other_quotes_stamp from _pre56))::text
            from vessl.quotes q where q.id not in (select quote_id from _pairs56)), 'true'
  union all
  select 'c1 quote row count unchanged',
         (select ((select count(*) from vessl.quotes) - quotes_before)::text from _pre56), '0'
  union all
  select 'c2 purchase order line and sales order line counts unchanged',
         (select ((select count(*) from vessl.purchase_order_items) - poi_before)::text || '/'
                 || ((select count(*) from vessl.sales_order_items) - soi_before)::text from _pre56), '0/0'
  union all
  select 'c3 no product row created or deleted',
         (select ((select count(*) from vessl.products) - products_before)::text from _pre56), '0'
  union all
  select 'c4 the 23 old product rows remain, still retired',
         (select count(*)::text from vessl.products p
           where p.id in (select old_product_id from _pairs56) and p.active is false), '23'
  union all
  select 'c5 programs fell by exactly 23',
         (select ((select count(*) from vessl.programs) - programs_before)::text from _pre56), '-23'
  union all
  select 'd1 the board reads 89 pipeline, 194 archived, 29 retired after',
         (select count(*) filter (where not b.done and b.active is not false)::text || '/'
                 || count(*) filter (where b.done)::text || '/'
                 || count(*) filter (where not b.done and b.active is false)::text
            from (select p.active,
                         (exists (select 1 from vessl.purchase_order_items l where l.product_id = pr.product_id)
                          or exists (select 1 from vessl.sales_order_items l where l.product_id = pr.product_id)) as done
                    from vessl.programs pr join vessl.products p on p.id = pr.product_id) b), '89/194/29'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
