-- 120 -- Product names and quote products in Title Case.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), read the list, then swap the last two lines and run again
-- to commit. Reversed by 120r, from the saved copy this script writes first.
--
-- WHAT IT DOES. Two columns only, vessl.products.name and vessl.quotes.product.
-- Each value is first put in the shape the app saves (lib/products cleanName),
-- the ends trimmed and every run of spaces, tabs or newlines made one space, and
-- then Title Cased word by word, the words split on spaces.
--   1 The first word has its first character uppercased if it is a-z.
--   2 A later word that is a small word is left exactly as typed. The small
--     words are a an and as at but by for in of on or the to with vs w/ w/o,
--     compared in lowercase with any leading open bracket and any trailing
--     comma, full stop, semicolon, bang, question mark or close bracket ignored.
--     They are never uppercased, and never lowered either.
--   3 A word containing a digit (480ml, 14, 1/4), or with letters and none of
--     them lowercase (VIP, ABS, XL), is left exactly as is.
--   4 Any other word gets its first letter uppercased, and every a-z directly
--     after a slash inside it (coaster/bottle to Coaster/Bottle, w/spikes to
--     W/Spikes). Not after a hyphen, so bag-same and Right-Handed keep the case
--     typed after it. The rest of the word stays as typed (mens to Mens).
-- Only rows whose value actually changes are touched. No SKU, no order line, no
-- other column. Rows whose sku starts with zztest (any case) are left alone.
-- A row whose only change is spacing is touched too, as the app would save it.
--
-- ONE-OFF FIX. The name AUto tag (license plate) with sku Auto tags, in either
-- table, becomes Auto Tag (License Plate) -- the rule alone would keep the
-- typed AUto. Matched on that sku, that exact text and its length (24), and
-- saved to z120_backup like every other change. a1 shows how many rows it hit.
--
-- THE SAME RULE IN CODE. lib/products.js cleanName and titleWord. The function
-- pg_temp.t120_word below is that function, line for line. It lives in the
-- session temp schema and is gone when the session ends.
--
-- THE SAVED COPY. vessl.z120_backup (row_id, tbl, sku, old_value, new_value),
-- one row per value changed, written BEFORE either update. 120r restores
-- old_value where the value still equals new_value. RLS on, no policy, no grant
-- to anon or authenticated. It stays after a commit until someone drops it.
--
-- TRIGGERS. quotes has trg_quote_code (script 103), which on update only keeps
-- quote_code as it was. b3 and b4 would show any other column a trigger changed.
--
-- GUARDS, before any change.
--   z120_backup does not exist yet
--   no product would end with the same (sku, name) as another product
--
-- WHAT A PASS LOOKS LIKE. a0, a1, then one r row per change (table, sku, old, new),
-- then z0 with the counts, on the rehearsal and again on the commit. z0 reads
-- still to change 0. Any b row is a failed check. Zero rows means the query did
-- not run.

begin;

set local vessl.change_note = 'script 120, product names and quote products in Title Case';

create function pg_temp.t120_word(w text, is_first boolean) returns text
language plpgsql immutable
as $fn$
declare
  k     text;
  res   text := '';
  c     text;
  prev  text := '';
  seen  boolean := false;
  i     int;
begin
  if w = '' then
    return w;
  end if;
  if is_first and left(w, 1) ~ '^[a-z]$' then
    w := upper(left(w, 1)) || substr(w, 2);
  end if;
  k := lower(regexp_replace(regexp_replace(w, '^[(]+', ''), '[,.;!?)]+$', ''));
  if not is_first and k in ('a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or',
                            'the', 'to', 'with', 'vs', 'w/', 'w/o') then
    return w;
  end if;
  if w ~ '[0-9]' or (w ~ '[A-Za-z]' and w !~ '[a-z]') then
    return w;
  end if;
  for i in 1 .. length(w) loop
    c := substr(w, i, 1);
    if c ~ '^[a-z]$' and (not seen or prev = '/') then
      c := upper(c);
    end if;
    if c ~ '^[A-Za-z]$' then
      seen := true;
    end if;
    res := res || c;
    prev := c;
  end loop;
  return res;
end
$fn$;

create function pg_temp.t120(v text) returns text
language sql immutable
as $fn$
  select string_agg(pg_temp.t120_word(x.w, x.n = 1), ' ' order by x.n)
    from regexp_split_to_table(
           regexp_replace(btrim(v, ' ' || chr(9) || chr(10) || chr(13)), '[ ' || chr(9) || chr(10) || chr(13) || ']+', ' ', 'g'),
           ' ') with ordinality as x(w, n)
$fn$;

-- The rows to touch and what each becomes, computed once, here. The one-off
-- fix takes the place of the rule on its rows.
create temp table _t120 on commit drop as
  with cand as (
    select 'products'::text as tbl, p.id::text as row_id, p.sku::text as sku, p.name::text as old_value,
           case when p.sku = 'Auto tags' and p.name = 'AUto tag (license plate)' and length(p.name) = 24
                then 'Auto Tag (License Plate)' else pg_temp.t120(p.name) end as new_value
      from vessl.products p
     where btrim(coalesce(p.name, ''), ' ' || chr(9) || chr(10) || chr(13)) <> ''
       and coalesce(p.sku, '') not ilike 'zztest%'
    union all
    select 'quotes'::text, q.id::text, q.sku::text, q.product::text,
           case when q.sku = 'Auto tags' and q.product = 'AUto tag (license plate)' and length(q.product) = 24
                then 'Auto Tag (License Plate)' else pg_temp.t120(q.product) end
      from vessl.quotes q
     where btrim(coalesce(q.product, ''), ' ' || chr(9) || chr(10) || chr(13)) <> ''
       and coalesce(q.sku, '') not ilike 'zztest%'
  )
  select tbl, row_id, sku, old_value, new_value from cand
   where new_value is distinct from old_value;

create temp table _pre120 on commit drop as
  select
    (select count(*) from information_schema.tables
      where table_schema = 'vessl' and table_name = 'z120_backup')                                      as has_backup,
    (select count(*) from _t120 where tbl = 'products')                                                 as n_prod,
    (select count(*) from _t120 where tbl = 'quotes')                                                   as n_quote,
    (select count(*) from vessl.products)                                                               as rows_prod,
    (select count(*) from vessl.quotes)                                                                 as rows_quote,
    -- (sku, name) pairs shared by more than one product once the new names are in.
    (select count(*) from (
       select p.sku, coalesce(t.new_value, p.name) as nm
         from vessl.products p
         left join _t120 t on t.tbl = 'products' and t.row_id = p.id::text
        where p.sku is not null
        group by p.sku, coalesce(t.new_value, p.name)
       having count(*) > 1) d)                                                                          as n_collide,
    -- Every untouched row, every column; and the touched rows without the column changed.
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
       from vessl.products p where p.id::text not in (select row_id from _t120 where tbl = 'products'))  as h_prod_other,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
       from vessl.quotes q where q.id::text not in (select row_id from _t120 where tbl = 'quotes'))      as h_quote_other,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'name')::text, '/' order by p.id::text), ''))
       from vessl.products p where p.id::text in (select row_id from _t120 where tbl = 'products'))      as h_prod_rest,
    (select md5(coalesce(string_agg((to_jsonb(q) - 'product')::text, '/' order by q.id::text), ''))
       from vessl.quotes q where q.id::text in (select row_id from _t120 where tbl = 'quotes'))          as h_quote_rest;

do $guard$
begin
  if (select has_backup from _pre120) <> 0 then
    raise exception 'vessl.z120_backup already exists, so 120 has run before, nothing changed';
  end if;
  if (select n_collide from _pre120) <> 0 then
    raise exception 'a new name would repeat the (sku, name) of another product, nothing changed';
  end if;
end
$guard$;

-- The saved copy, first.
create table vessl.z120_backup (
  row_id     text not null,
  tbl        text not null check (tbl in ('products', 'quotes')),
  sku        text,
  old_value  text not null,
  new_value  text not null,
  saved_at   timestamptz not null default now(),
  primary key (tbl, row_id)
);
comment on table vessl.z120_backup is
  'Script 120. The product names and quote products before 120 put them in Title Case. 120r restores from it. Drop it once 120 is settled.';
alter table vessl.z120_backup enable row level security;
revoke all on vessl.z120_backup from anon;
revoke all on vessl.z120_backup from authenticated;

insert into vessl.z120_backup (row_id, tbl, sku, old_value, new_value)
  select row_id, tbl, sku, old_value, new_value from _t120;

update vessl.products p
   set name = t.new_value
  from _t120 t
 where t.tbl = 'products' and t.row_id = p.id::text;

update vessl.quotes q
   set product = t.new_value
  from _t120 t
 where t.tbl = 'quotes' and t.row_id = q.id::text;

-- VERIFICATION. a0, the r rows and z0 always show and are a pass. Any b row is
-- a failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, to change products = ' || (select n_prod::text from _pre120)
           || ', quotes = ' || (select n_quote::text from _pre120) as chk,
         'shown'::text as got, 'always'::text as want,
         null::text as tbl, null::text as sku, null::text as old_value, null::text as new_value
  union all
  select 'a1 one-off fix, products = '
           || (select count(*)::text from vessl.z120_backup
                where tbl = 'products' and old_value = 'AUto tag (license plate)' and new_value = 'Auto Tag (License Plate)')
           || ', quotes = '
           || (select count(*)::text from vessl.z120_backup
                where tbl = 'quotes' and old_value = 'AUto tag (license plate)' and new_value = 'Auto Tag (License Plate)'),
         'shown'::text, 'always'::text, null::text, null::text, null::text, null::text
  union all
  select 'b1 saved copy holds every change',
         (select count(*)::text from vessl.z120_backup),
         (select (n_prod + n_quote)::text from _pre120),
         null::text, null::text, null::text, null::text
  union all
  select 'b3 changed products, every other column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(p) - 'name')::text, '/' order by p.id::text), ''))
                           = (select h_prod_rest from _pre120) then 'same' else 'changed' end
            from vessl.products p where p.id::text in (select row_id from vessl.z120_backup where tbl = 'products')),
         'same'::text, null::text, null::text, null::text, null::text
  union all
  select 'b4 changed quotes, every other column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(q) - 'product')::text, '/' order by q.id::text), ''))
                           = (select h_quote_rest from _pre120) then 'same' else 'changed' end
            from vessl.quotes q where q.id::text in (select row_id from vessl.z120_backup where tbl = 'quotes')),
         'same'::text, null::text, null::text, null::text, null::text
  union all
  select 'b5 every other product unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
                           = (select h_prod_other from _pre120) then 'same' else 'changed' end
            from vessl.products p where p.id::text not in (select row_id from vessl.z120_backup where tbl = 'products')),
         'same'::text, null::text, null::text, null::text, null::text
  union all
  select 'b6 every other quote unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
                           = (select h_quote_other from _pre120) then 'same' else 'changed' end
            from vessl.quotes q where q.id::text not in (select row_id from vessl.z120_backup where tbl = 'quotes')),
         'same'::text, null::text, null::text, null::text, null::text
  union all
  select 'b7 every changed value reads its new value',
         (select count(*)::text from vessl.z120_backup b
           where b.new_value is distinct from case b.tbl
                   when 'products' then (select p.name::text from vessl.products p where p.id::text = b.row_id)
                   else (select q.product::text from vessl.quotes q where q.id::text = b.row_id) end),
         '0'::text, null::text, null::text, null::text, null::text
  union all
  select 'b8 no zztest row touched',
         (select count(*)::text from vessl.z120_backup where sku ilike 'zztest%'),
         '0'::text, null::text, null::text, null::text, null::text
  union all
  select 'b9 same number of products and quotes',
         (select count(*)::text from vessl.products) || ' / ' || (select count(*)::text from vessl.quotes),
         (select rows_prod::text || ' / ' || rows_quote::text from _pre120),
         null::text, null::text, null::text, null::text
  union all
  select 'r change'::text, 'shown'::text, 'always'::text,
         b.tbl::text, b.sku::text, b.old_value::text, b.new_value::text
    from vessl.z120_backup b
  union all
  select 'z0 verification ran, changed products = '
           || (select count(*)::text from vessl.z120_backup where tbl = 'products')
           || ', quotes = '
           || (select count(*)::text from vessl.z120_backup where tbl = 'quotes')
           || ', still to change products = '
           || (select count(*)::text from vessl.products
                where btrim(coalesce(name, ''), ' ' || chr(9) || chr(10) || chr(13)) <> ''
                  and coalesce(sku, '') not ilike 'zztest%' and pg_temp.t120(name) is distinct from name)
           || ', quotes = '
           || (select count(*)::text from vessl.quotes
                where btrim(coalesce(product, ''), ' ' || chr(9) || chr(10) || chr(13)) <> ''
                  and coalesce(sku, '') not ilike 'zztest%' and pg_temp.t120(product) is distinct from product),
         'shown'::text, 'always'::text, null::text, null::text, null::text, null::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'a1%'
   or chk like 'r %'
   or chk like 'z0%'
order by chk, tbl, sku, old_value;

-- a0, the r rows, and z0 reading still to change 0 and 0? Then swap these two
-- lines.
-- commit;
rollback;
