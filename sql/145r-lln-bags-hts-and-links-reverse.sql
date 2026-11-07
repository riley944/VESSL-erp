-- 145r -- Reverse of 145. The three bags lose HTS 6305390000 again, and the
-- three FQ-JJC0M lines lose their link.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES.
--   1. quotes Q-0333, Q-0285, Q-0286, by id -- hts back to empty (null), only
--      while it still reads 6305390000; updated_at now, updated_by the address
--      that ran it. The stamp 145 replaced is not restored.
--   2. products LLN-501, LLN-500, LLN-473, by id -- hts_code back to null, only
--      while it still reads 6305390000; updated_at now.
--   3. FQ-JJC0M, FQ-JBTRQ, FQ-JJQNY -- quote_id, quote_code and sku taken off
--      lines 1 to 3 again (145 added all three; none of the lines had a sku
--      before). Every other key is left as it is. updated_at now.
--
-- GUARDS, before any change.
--   the three quotes and three products still read 6305390000
--   the RFQ group is the three rows, still identical, each line still linked as
--   145 linked it
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _t145r on commit drop as
  select * from (values
    (1, '5398f477-58f9-4438-89dc-844cbb71d690'::uuid, 'Q-0333', 'LLN-501', '9dd17fc0-91cc-4acc-b791-f5ca8f80ad10'::uuid, 'LLNY XLARGE MMW Bag'),
    (2, 'a1913a2f-b17e-4b70-96d3-cf81724075b6'::uuid, 'Q-0285', 'LLN-500', 'c6345da1-5625-4f89-9f24-795e916ed8cf'::uuid, 'LLN-500'),
    (3, 'ed5e4669-487b-4ca9-9dbe-31f9df1a3f6c'::uuid, 'Q-0286', 'LLN-473', '927dc969-9724-412a-bea4-947f392cb950'::uuid, 'LLN-473')
  ) v(pos, quote_id, quote_code, sku, product_id, line_desc);

create temp table _g145r on commit drop as
  select * from (values
    ('d14e7e62-28f2-4bdc-bc63-51058fc9eac6'::uuid),
    ('b50194bb-e676-4849-b401-2ab0d7fa677f'::uuid),
    ('5e3f266e-cfae-44eb-9f64-43a7b1aa4fa9'::uuid)
  ) v(id);

create temp table _pre145r on commit drop as
  select
    (select count(*) from vessl.quotes q join _t145r t on t.quote_id = q.id
      where q.quote_code = t.quote_code and q.hts = '6305390000')                                     as n_quotes,
    (select count(*) from vessl.products p join _t145r t on t.product_id = p.id
      where p.sku = t.sku and p.hts_code = '6305390000')                                               as n_products,
    (select count(*) from vessl.shipment_quotes
      where rfq_group_id = '20d73d0b-33e9-4d73-97b1-703734eb4c91')                                     as n_group,
    (select count(distinct md5(s.line_items::text)) from vessl.shipment_quotes s join _g145r g on g.id = s.id) as n_shapes,
    (select count(*) from vessl.shipment_quotes s join _g145r g on g.id = s.id
      cross join lateral jsonb_array_elements(s.line_items) with ordinality x(e, ord)
      join _t145r t on t.pos = x.ord
      where x.e ->> 'desc' = t.line_desc and x.e ->> 'quote_id' = t.quote_id::text
        and x.e ->> 'quote_code' = t.quote_code and x.e ->> 'sku' = t.sku
        and jsonb_array_length(s.line_items) = 3)                                                      as n_lines_ok;

do $guard$
begin
  if (select n_quotes from _pre145r) <> 3 or (select n_products from _pre145r) <> 3 then
    raise exception 'the quotes or products no longer all read 6305390000, nothing changed';
  end if;
  if (select n_group from _pre145r) <> 3 or (select n_shapes from _pre145r) <> 1 or (select n_lines_ok from _pre145r) <> 9 then
    raise exception 'the RFQ group lines are not as 145 left them, nothing changed';
  end if;
end
$guard$;

update vessl.quotes q
   set hts = null, updated_at = now(), updated_by = 'mattdillon@kinguniversal.com'
  from _t145r t
 where q.id = t.quote_id and q.hts = '6305390000';

update vessl.products p
   set hts_code = null, updated_at = now()
  from _t145r t
 where p.id = t.product_id and p.hts_code = '6305390000';

update vessl.shipment_quotes s
   set line_items = (
         select jsonb_agg(case when x.ord <= 3 then x.e - 'quote_id' - 'quote_code' - 'sku' else x.e end order by x.ord)
           from jsonb_array_elements(s.line_items) with ordinality x(e, ord)),
       updated_at = now()
 where s.id in (select id from _g145r);

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, quotes / products / linked lines = '
         || (select n_quotes::text || ' / ' || n_products::text || ' / ' || n_lines_ok::text from _pre145r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 quotes and products -- no HTS code again',
         (select count(*)::text from vessl.quotes q join _t145r t on t.quote_id = q.id where q.hts is null)
         || '/' || (select count(*)::text from vessl.products p join _t145r t on t.product_id = p.id where p.hts_code is null),
         '3/3'::text
  union all
  select 'b2 freight rows -- identical, no line linked',
         (select count(distinct md5(s.line_items::text))::text from vessl.shipment_quotes s join _g145r g on g.id = s.id)
         || '/' || (select count(*)::text from vessl.shipment_quotes s join _g145r g on g.id = s.id
                      cross join lateral jsonb_array_elements(s.line_items) x(e)
                     where x.e ? 'quote_id' or x.e ? 'quote_code' or x.e ? 'sku'),
         '1/0'::text
  union all
  select 'z0 verification ran',
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
