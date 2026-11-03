-- 145 -- HTS 6305390000 on the three Legoland New York bags, and their freight
-- quote lines linked to their product quotes.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 145r.
-- Rehearse as written (it ends in rollback), then swap the last two lines and
-- run again to commit.
--
-- WHY. Kristy confirmed HTS 6305390000 (library row, Reuse Shopping Bags,
-- 28.40 percent) for LLN-501, LLN-473 and LLN-500 on 3 Nov. Their quotes and
-- products carry no code, and freight quote FQ-JJC0M (Ship Tech, awarded) and
-- its two RFQ siblings hold the three lines as typed text with no quote_id, so
-- the bid breakdown had no unit cost and no duty rate for any of them.
--
-- WHAT IT DOES. All in vessl, one database (the quotes client is the same
-- client as the rest of the app).
--   1. quotes Q-0333 (LLN-501), Q-0286 (LLN-473), Q-0285 (LLN-500), by id --
--      hts = 6305390000 where it is empty, updated_at now, updated_by the
--      address that ran it, as the quote form stamps a save. Tier duty figures
--      are NOT recomputed (the quote form does that when a code is picked
--      there); the bid breakdown reads the rate from the library either way.
--   2. products LLN-501, LLN-473, LLN-500, by id -- hts_code = 6305390000
--      where it is empty, updated_at now (products has no updated_by).
--   3. FQ-JJC0M, FQ-JBTRQ, FQ-JJQNY (RFQ group 20d73d0b...) -- in line_items,
--      line 1 (LLNY XLARGE MMW Bag) gets quote_id, quote_code and sku of
--      Q-0333, line 2 (LLN-500) those of Q-0285, line 3 (LLN-473) those of
--      Q-0286. Every other key of every line is left as it is. updated_at now
--      (shipment_quotes has no trigger).
-- Nothing else. No order, shipment or notification is touched.
--
-- GUARDS, before any change.
--   library row 6305390000 exists once, active, total_duty 28.40
--   the three quotes exist by id with these codes and SKUs, hts empty
--   the three products exist by id with these SKUs, hts_code empty
--   the RFQ group has exactly these three rows, all three line_items identical,
--   three lines reading these descriptions in this order, none linked
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.
-- b4 reads the breakdown inputs back the way the bid breakdown finds them --
-- line, quote by quote_id, its HTS, the library duty for those digits, and a
-- priced tier -- so a pass there means the breakdown has cost and duty for all
-- three lines.

begin;

create temp table _t145 on commit drop as
  select * from (values
    (1, '5398f477-58f9-4438-89dc-844cbb71d690'::uuid, 'Q-0333', 'LLN-501', '9dd17fc0-91cc-4acc-b791-f5ca8f80ad10'::uuid, 'LLNY XLARGE MMW Bag'),
    (2, 'a1913a2f-b17e-4b70-96d3-cf81724075b6'::uuid, 'Q-0285', 'LLN-500', 'c6345da1-5625-4f89-9f24-795e916ed8cf'::uuid, 'LLN-500'),
    (3, 'ed5e4669-487b-4ca9-9dbe-31f9df1a3f6c'::uuid, 'Q-0286', 'LLN-473', '927dc969-9724-412a-bea4-947f392cb950'::uuid, 'LLN-473')
  ) v(pos, quote_id, quote_code, sku, product_id, line_desc);

create temp table _g145 on commit drop as
  select * from (values
    ('d14e7e62-28f2-4bdc-bc63-51058fc9eac6'::uuid, 'FQ-JJC0M'),
    ('b50194bb-e676-4849-b401-2ab0d7fa677f'::uuid, 'FQ-JBTRQ'),
    ('5e3f266e-cfae-44eb-9f64-43a7b1aa4fa9'::uuid, 'FQ-JJQNY')
  ) v(id, quote_number);

create temp table _pre145 on commit drop as
  select
    (select count(*) from vessl.htscodes
      where code = '6305390000' and active and total_duty = 28.40)                                   as n_code,
    (select count(*) from vessl.quotes q join _t145 t on t.quote_id = q.id
      where q.quote_code = t.quote_code and length(q.quote_code) = 6 and q.sku = t.sku
        and coalesce(trim(q.hts), '') = '')                                                          as n_quotes,
    (select count(*) from vessl.products p join _t145 t on t.product_id = p.id
      where p.sku = t.sku and length(p.sku) = 7 and coalesce(trim(p.hts_code), '') = '')           as n_products,
    (select count(*) from vessl.shipment_quotes s
      where s.rfq_group_id = '20d73d0b-33e9-4d73-97b1-703734eb4c91')                                 as n_group,
    (select count(*) from vessl.shipment_quotes s join _g145 g on g.id = s.id
      where s.quote_number = g.quote_number and length(s.quote_number) = 8
        and s.rfq_group_id = '20d73d0b-33e9-4d73-97b1-703734eb4c91')                                 as n_group_named,
    (select count(distinct md5(s.line_items::text)) from vessl.shipment_quotes s join _g145 g on g.id = s.id) as n_shapes,
    (select count(*) from vessl.shipment_quotes s join _g145 g on g.id = s.id
      cross join lateral jsonb_array_elements(s.line_items) with ordinality x(e, ord)
      join _t145 t on t.pos = x.ord
      where x.e ->> 'desc' = t.line_desc and coalesce(x.e ->> 'quote_id', '') = ''
        and coalesce(x.e ->> 'quote_code', '') = '' and coalesce(x.e ->> 'sku', '') = ''
        and jsonb_array_length(s.line_items) = 3)                                                    as n_lines_ok,
    (select line_items from vessl.shipment_quotes where id = 'd14e7e62-28f2-4bdc-bc63-51058fc9eac6') as items_before,
    -- Every other row, every column, so b5 can prove none moved.
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
       from vessl.quotes q where q.id not in (select quote_id from _t145))                          as h_quotes,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), ''))
       from vessl.products p where p.id not in (select product_id from _t145))                      as h_products,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.shipment_quotes s where s.id not in (select id from _g145))                       as h_sq;

do $guard$
begin
  if (select n_code from _pre145) <> 1 then
    raise exception 'library row 6305390000 is not there once, active, at 28.40, nothing changed';
  end if;
  if (select n_quotes from _pre145) <> 3 then
    raise exception 'the three quotes are not as measured or one already has an HTS code, nothing changed';
  end if;
  if (select n_products from _pre145) <> 3 then
    raise exception 'the three products are not as measured or one already has an HTS code, nothing changed';
  end if;
  if (select n_group from _pre145) <> 3 or (select n_group_named from _pre145) <> 3 then
    raise exception 'the RFQ group is not the three rows measured, nothing changed';
  end if;
  if (select n_shapes from _pre145) <> 1 then
    raise exception 'the RFQ group rows hold different line_items, nothing changed';
  end if;
  if (select n_lines_ok from _pre145) <> 9 then
    raise exception 'a line does not read as measured or is already linked, nothing changed';
  end if;
end
$guard$;

-- 1. quotes
update vessl.quotes q
   set hts = '6305390000', updated_at = now(), updated_by = 'mattdillon@kinguniversal.com'
  from _t145 t
 where q.id = t.quote_id and coalesce(trim(q.hts), '') = '';

-- 2. products
update vessl.products p
   set hts_code = '6305390000', updated_at = now()
  from _t145 t
 where p.id = t.product_id and coalesce(trim(p.hts_code), '') = '';

-- 3. the three freight quote lines, on every row of the RFQ group
update vessl.shipment_quotes s
   set line_items = (
         select jsonb_agg(x.e || jsonb_build_object('quote_id', t.quote_id::text, 'quote_code', t.quote_code, 'sku', t.sku)
                          order by x.ord)
           from jsonb_array_elements(s.line_items) with ordinality x(e, ord)
           join _t145 t on t.pos = x.ord),
       updated_at = now()
 where s.id in (select id from _g145);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, quotes / products / freight rows to change = '
         || (select n_quotes::text || ' / ' || n_products::text || ' / ' || n_group::text from _pre145) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 quotes -- code kept, hts set, stamped',
         (select string_agg(q.quote_code || ' ' || coalesce(q.hts, 'none') || ' ' || coalesce(q.updated_by, 'none'), ', ' order by t.pos)
            from vessl.quotes q join _t145 t on t.quote_id = q.id),
         'Q-0333 6305390000 mattdillon@kinguniversal.com, Q-0285 6305390000 mattdillon@kinguniversal.com, Q-0286 6305390000 mattdillon@kinguniversal.com'::text
  union all
  select 'b2 products -- hts_code set',
         (select string_agg(p.sku || ' ' || coalesce(p.hts_code, 'none'), ', ' order by t.pos)
            from vessl.products p join _t145 t on t.product_id = p.id),
         'LLN-501 6305390000, LLN-500 6305390000, LLN-473 6305390000'::text
  union all
  select 'b3 freight rows -- still identical, each line linked, nothing else on a line changed',
         (select count(distinct md5(s.line_items::text))::text from vessl.shipment_quotes s join _g145 g on g.id = s.id)
         || '/' || (select count(*)::text from vessl.shipment_quotes s join _g145 g on g.id = s.id
                      cross join lateral jsonb_array_elements(s.line_items) with ordinality x(e, ord)
                      join _t145 t on t.pos = x.ord
                     where x.e ->> 'quote_id' = t.quote_id::text and x.e ->> 'quote_code' = t.quote_code and x.e ->> 'sku' = t.sku)
         || '/' || (select count(*)::text from vessl.shipment_quotes s join _g145 g on g.id = s.id
                     where (select jsonb_agg(x.e - 'quote_id' - 'quote_code' - 'sku' order by x.ord)
                              from jsonb_array_elements(s.line_items) with ordinality x(e, ord))
                           = (select items_before from _pre145)),
         '1/9/3'::text
  union all
  select 'b4 breakdown inputs -- each line finds its quote, a library duty and a priced tier',
         (select string_agg(q.quote_code || ' duty ' || coalesce(h.total_duty::text, 'none')
                   || ' ' || case when exists (select 1 from jsonb_array_elements(coalesce(q.tiers, '[]'::jsonb)) tr
                                               where (tr ->> 'landed') ~ '^[0-9.]+$' and (tr ->> 'landed')::numeric > 0)
                                  then 'priced' else 'unpriced' end, ', ' order by x.ord)
            from vessl.shipment_quotes s
            cross join lateral jsonb_array_elements(s.line_items) with ordinality x(e, ord)
            left join vessl.quotes q on q.id::text = x.e ->> 'quote_id'
            left join vessl.htscodes h on h.active and regexp_replace(h.code, '[^0-9]', '', 'g') = regexp_replace(coalesce(q.hts, ''), '[^0-9]', '', 'g')
           where s.id = 'd14e7e62-28f2-4bdc-bc63-51058fc9eac6'),
         'Q-0333 duty 28.40 priced, Q-0285 duty 28.40 priced, Q-0286 duty 28.40 priced'::text
  union all
  select 'b5 every other quote, product and freight quote unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) = (select h_quotes from _pre145)
                      then 'same' else 'changed' end from vessl.quotes q where q.id not in (select quote_id from _t145))
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) = (select h_products from _pre145)
                      then 'same' else 'changed' end from vessl.products p where p.id not in (select product_id from _t145))
         || '/' || (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_sq from _pre145)
                      then 'same' else 'changed' end from vessl.shipment_quotes s where s.id not in (select id from _g145)),
         'same/same/same'::text
  union all
  select 'z0 verification ran, quotes now on 6305390000 = '
         || (select count(*)::text from vessl.quotes where hts = '6305390000'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
