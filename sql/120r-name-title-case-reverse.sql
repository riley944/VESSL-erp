-- 120r -- Reverse of 120. Product names and quote products back as they were.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
--
-- WHAT IT DOES. For every row in vessl.z120_backup, puts old_value back into
-- vessl.products.name or vessl.quotes.product -- but ONLY where the value still
-- equals new_value, the text 120 wrote. A value somebody has edited since is
-- left alone and counted in a0 and z0, so their edit is never overwritten. No
-- other row, no other column.
--
-- THE SAVED COPY STAYS. z120_backup is not dropped here, so the skipped rows
-- can still be read and settled by hand. Drop it once that is done.
--
-- GUARDS, before any change.
--   z120_backup exists (120 has been committed)
--   no restored product would repeat the (sku, name) of another product
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (before) and z0 (after), on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

set local vessl.change_note = 'script 120r, reverse of 120, product names and quote products restored';

do $guard$
begin
  if (select count(*) from information_schema.tables
       where table_schema = 'vessl' and table_name = 'z120_backup') <> 1 then
    raise exception 'vessl.z120_backup does not exist, so 120 was not committed, nothing changed';
  end if;
end
$guard$;

-- The rows still holding what 120 wrote, so safe to restore.
create temp table _r120 on commit drop as
  select b.tbl, b.row_id, b.old_value, b.new_value
    from vessl.z120_backup b
   where (b.tbl = 'products' and exists (select 1 from vessl.products p where p.id::text = b.row_id and p.name = b.new_value))
      or (b.tbl = 'quotes'   and exists (select 1 from vessl.quotes q where q.id::text = b.row_id and q.product = b.new_value));

create temp table _pre120r on commit drop as
  select
    (select count(*) from vessl.z120_backup)                                                            as n_backup,
    (select count(*) from _r120 where tbl = 'products')                                                 as n_prod,
    (select count(*) from _r120 where tbl = 'quotes')                                                   as n_quote,
    (select count(*) from vessl.products)                                                               as rows_prod,
    (select count(*) from vessl.quotes)                                                                 as rows_quote,
    (select count(*) from (
       select p.sku, coalesce(r.old_value, p.name) as nm
         from vessl.products p
         left join _r120 r on r.tbl = 'products' and r.row_id = p.id::text
        where p.sku is not null
        group by p.sku, coalesce(r.old_value, p.name)
       having count(*) > 1) d)                                                                          as n_collide,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
       from vessl.products p where p.id::text not in (select row_id from _r120 where tbl = 'products'))  as h_prod_other,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
       from vessl.quotes q where q.id::text not in (select row_id from _r120 where tbl = 'quotes'))      as h_quote_other,
    (select md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.tbl, b.row_id), ''))
       from vessl.z120_backup b)                                                                        as h_backup;

do $guard$
begin
  if (select n_collide from _pre120r) <> 0 then
    raise exception 'a restored name would repeat the (sku, name) of another product, nothing changed';
  end if;
end
$guard$;

update vessl.products p
   set name = r.old_value
  from _r120 r
 where r.tbl = 'products' and r.row_id = p.id::text and p.name = r.new_value;

update vessl.quotes q
   set product = r.old_value
  from _r120 r
 where r.tbl = 'quotes' and r.row_id = q.id::text and q.product = r.new_value;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, saved rows = ' || (select n_backup::text from _pre120r)
           || ', to restore products = ' || (select n_prod::text from _pre120r)
           || ', quotes = ' || (select n_quote::text from _pre120r)
           || ', edited since and skipped = ' || (select (n_backup - n_prod - n_quote)::text from _pre120r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 every restored value reads its old value',
         (select count(*)::text from _r120 r
           where r.old_value is distinct from case r.tbl
                   when 'products' then (select p.name::text from vessl.products p where p.id::text = r.row_id)
                   else (select q.product::text from vessl.quotes q where q.id::text = r.row_id) end),
         '0'::text
  union all
  select 'b2 every other product unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
                           = (select h_prod_other from _pre120r) then 'same' else 'changed' end
            from vessl.products p where p.id::text not in (select row_id from _r120 where tbl = 'products')),
         'same'::text
  union all
  select 'b3 every other quote unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
                           = (select h_quote_other from _pre120r) then 'same' else 'changed' end
            from vessl.quotes q where q.id::text not in (select row_id from _r120 where tbl = 'quotes')),
         'same'::text
  union all
  select 'b4 saved copy unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.tbl, b.row_id), ''))
                           = (select h_backup from _pre120r) then 'same' else 'changed' end
            from vessl.z120_backup b),
         'same'::text
  union all
  select 'b5 same number of products and quotes',
         (select count(*)::text from vessl.products) || ' / ' || (select count(*)::text from vessl.quotes),
         (select rows_prod::text || ' / ' || rows_quote::text from _pre120r)
  union all
  select 'z0 verification ran, restored products = '
           || (select count(*)::text from _r120 r join vessl.products p on p.id::text = r.row_id
                where r.tbl = 'products' and p.name = r.old_value)
           || ', quotes = '
           || (select count(*)::text from _r120 r join vessl.quotes q on q.id::text = r.row_id
                where r.tbl = 'quotes' and q.product = r.old_value)
           || ', skipped = ' || (select (n_backup - n_prod - n_quote)::text from _pre120r),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
