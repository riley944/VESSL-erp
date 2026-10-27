-- 119 -- Product names and quote products start with a capital letter.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- Reversed by 119r, from the saved copy this script writes first.
--
-- WHAT IT DOES. Two columns only, vessl.products.name and vessl.quotes.product.
-- A row is touched when its value, trimmed, starts with a-z. On those rows only,
-- the value becomes the same text with
--   the ends trimmed (spaces, tabs, newlines),
--   every run of two or more spaces collapsed to one,
--   the first character uppercased.
-- Nothing else in the text changes, so the second word keeps its case. No SKU,
-- no order line, no other column. Rows whose sku starts with zztest (any case)
-- are left alone, in both tables -- the zztestplm demo rows.
--
-- THE SAVED COPY. vessl.z119_backup (row_id, tbl, old_value, new_value), one
-- row per value changed, written BEFORE either update. row_id is the id as
-- text. 119r restores old_value where the value still equals new_value. The
-- table has RLS on and no policy, and anon and authenticated have no grant, so
-- the app cannot read it. It stays after a commit until someone drops it.
--
-- TRIGGERS. quotes has trg_quote_code (script 103), which on update only keeps
-- quote_code as it was. products has none in these scripts. b3 and b4 would
-- show any other column a trigger changed.
--
-- EXPECTED. 38 products and 40 quotes, from the 118 audit. 118 counted every
-- value not starting A-Z or 0-9, zztest rows included, so these counts can
-- differ. A difference shows as a b1 or b2 row and changes nothing by itself;
-- read a0, then decide.
--
-- GUARDS, before any change.
--   z119_backup does not exist yet
--   no product would end with the same (sku, name) as another product, the
--   pair products_sku_name_key keeps unique
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (before) and z0 (after), on the
-- rehearsal and again on the commit. z0 reads still lowercase 0 and 0. Any b
-- row is a failed check. Zero rows means the query did not run.

begin;

set local vessl.change_note = 'script 119, first letter of product names and quote products uppercased';

-- The rows to touch and what each becomes. new_value is computed once, here.
create temp table _t119 on commit drop as
  select 'products'::text as tbl, p.id::text as row_id, p.name::text as old_value,
         upper(left(v.s, 1)) || substr(v.s, 2) as new_value
    from vessl.products p
   cross join lateral (select regexp_replace(btrim(p.name, ' ' || chr(9) || chr(10) || chr(13)), ' {2,}', ' ', 'g') as s) v
   where btrim(p.name, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]'
     and coalesce(p.sku, '') not ilike 'zztest%'
  union all
  select 'quotes'::text, q.id::text, q.product::text,
         upper(left(v.s, 1)) || substr(v.s, 2)
    from vessl.quotes q
   cross join lateral (select regexp_replace(btrim(q.product, ' ' || chr(9) || chr(10) || chr(13)), ' {2,}', ' ', 'g') as s) v
   where btrim(q.product, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]'
     and coalesce(q.sku, '') not ilike 'zztest%';

create temp table _pre119 on commit drop as
  select
    (select count(*) from information_schema.tables
      where table_schema = 'vessl' and table_name = 'z119_backup')                                      as has_backup,
    (select count(*) from _t119 where tbl = 'products')                                                 as n_prod,
    (select count(*) from _t119 where tbl = 'quotes')                                                   as n_quote,
    (select count(*) from vessl.products)                                                               as rows_prod,
    (select count(*) from vessl.quotes)                                                                 as rows_quote,
    -- (sku, name) pairs shared by more than one product once the new names are in.
    (select count(*) from (
       select p.sku, coalesce(t.new_value, p.name) as nm
         from vessl.products p
         left join _t119 t on t.tbl = 'products' and t.row_id = p.id::text
        where p.sku is not null
        group by p.sku, coalesce(t.new_value, p.name)
       having count(*) > 1) d)                                                                          as n_collide,
    -- Every untouched row, every column; and the touched rows without the column changed.
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
       from vessl.products p where p.id::text not in (select row_id from _t119 where tbl = 'products'))  as h_prod_other,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
       from vessl.quotes q where q.id::text not in (select row_id from _t119 where tbl = 'quotes'))      as h_quote_other,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'name')::text, '/' order by p.id::text), ''))
       from vessl.products p where p.id::text in (select row_id from _t119 where tbl = 'products'))      as h_prod_rest,
    (select md5(coalesce(string_agg((to_jsonb(q) - 'product')::text, '/' order by q.id::text), ''))
       from vessl.quotes q where q.id::text in (select row_id from _t119 where tbl = 'quotes'))          as h_quote_rest;

do $guard$
begin
  if (select has_backup from _pre119) <> 0 then
    raise exception 'vessl.z119_backup already exists, so 119 has run before, nothing changed';
  end if;
  if (select n_collide from _pre119) <> 0 then
    raise exception 'a new name would repeat the (sku, name) of another product, nothing changed';
  end if;
end
$guard$;

-- The saved copy, first.
create table vessl.z119_backup (
  row_id     text not null,
  tbl        text not null check (tbl in ('products', 'quotes')),
  old_value  text not null,
  new_value  text not null,
  saved_at   timestamptz not null default now(),
  primary key (tbl, row_id)
);
comment on table vessl.z119_backup is
  'Script 119. The product names and quote products before 119 uppercased their first letter. 119r restores from it. Drop it once 119 is settled.';
alter table vessl.z119_backup enable row level security;
revoke all on vessl.z119_backup from anon;
revoke all on vessl.z119_backup from authenticated;

insert into vessl.z119_backup (row_id, tbl, old_value, new_value)
  select row_id, tbl, old_value, new_value from _t119;

update vessl.products p
   set name = t.new_value
  from _t119 t
 where t.tbl = 'products' and t.row_id = p.id::text;

update vessl.quotes q
   set product = t.new_value
  from _t119 t
 where t.tbl = 'quotes' and t.row_id = q.id::text;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, to touch products = ' || (select n_prod::text from _pre119)
           || ', quotes = ' || (select n_quote::text from _pre119) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 products updated, 38 expected',
         (select count(*)::text from vessl.z119_backup where tbl = 'products'), '38'::text
  union all
  select 'b2 quotes updated, 40 expected',
         (select count(*)::text from vessl.z119_backup where tbl = 'quotes'), '40'::text
  union all
  select 'b3 touched products, every other column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(p) - 'name')::text, '/' order by p.id::text), ''))
                           = (select h_prod_rest from _pre119) then 'same' else 'changed' end
            from vessl.products p where p.id::text in (select row_id from vessl.z119_backup where tbl = 'products')),
         'same'::text
  union all
  select 'b4 touched quotes, every other column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(q) - 'product')::text, '/' order by q.id::text), ''))
                           = (select h_quote_rest from _pre119) then 'same' else 'changed' end
            from vessl.quotes q where q.id::text in (select row_id from vessl.z119_backup where tbl = 'quotes')),
         'same'::text
  union all
  select 'b5 every other product unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id::text), ''))
                           = (select h_prod_other from _pre119) then 'same' else 'changed' end
            from vessl.products p where p.id::text not in (select row_id from vessl.z119_backup where tbl = 'products')),
         'same'::text
  union all
  select 'b6 every other quote unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id::text), ''))
                           = (select h_quote_other from _pre119) then 'same' else 'changed' end
            from vessl.quotes q where q.id::text not in (select row_id from vessl.z119_backup where tbl = 'quotes')),
         'same'::text
  union all
  select 'b7 every touched value reads its new value',
         (select count(*)::text from vessl.z119_backup b
           where b.new_value is distinct from case b.tbl
                   when 'products' then (select p.name::text from vessl.products p where p.id::text = b.row_id)
                   else (select q.product::text from vessl.quotes q where q.id::text = b.row_id) end),
         '0'::text
  union all
  select 'b8 no zztest row touched',
         ((select count(*) from vessl.products p join vessl.z119_backup b on b.tbl = 'products' and b.row_id = p.id::text
            where p.sku ilike 'zztest%')
        + (select count(*) from vessl.quotes q join vessl.z119_backup b on b.tbl = 'quotes' and b.row_id = q.id::text
            where q.sku ilike 'zztest%'))::text,
         '0'::text
  union all
  select 'b9 same number of products and quotes',
         (select count(*)::text from vessl.products) || ' / ' || (select count(*)::text from vessl.quotes),
         (select rows_prod::text || ' / ' || rows_quote::text from _pre119)
  union all
  select 'b10 products still starting lowercase, zztest aside',
         (select count(*)::text from vessl.products
           where btrim(name, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]' and coalesce(sku, '') not ilike 'zztest%'),
         '0'::text
  union all
  select 'b11 quotes still starting lowercase, zztest aside',
         (select count(*)::text from vessl.quotes
           where btrim(product, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]' and coalesce(sku, '') not ilike 'zztest%'),
         '0'::text
  union all
  select 'z0 verification ran, still lowercase products = '
           || (select count(*)::text from vessl.products
                where btrim(name, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]' and coalesce(sku, '') not ilike 'zztest%')
           || ', quotes = '
           || (select count(*)::text from vessl.quotes
                where btrim(product, ' ' || chr(9) || chr(10) || chr(13)) ~ '^[a-z]' and coalesce(sku, '') not ilike 'zztest%')
           || ', updated products = '
           || (select count(*)::text from vessl.z119_backup where tbl = 'products')
           || ', quotes = '
           || (select count(*)::text from vessl.z119_backup where tbl = 'quotes'),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0, and z0 reads still lowercase 0 and 0? Then swap these
-- two lines.
-- commit;
rollback;
