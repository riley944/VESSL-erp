-- 118 -- Name capitalisation audit. READ ONLY, report only, changes nothing.
--
-- RUN AS postgres IN THE SQL EDITOR. No reverse, because nothing is written.
-- The whole file runs inside a READ ONLY transaction that ends in rollback, so
-- even a mistake in it cannot write. There is no commit line to swap.
--
-- WHAT IT REPORTS, one result set, sorted by chk. A count row for every test,
-- then one row per offending record under it.
--   a1  products, name does not start with an uppercase letter or a digit
--   a2  products, a word in name starts lowercase (Title Case candidates)
--   c1  quotes.product, the a1 test
--   c2  quotes.product, the a2 test
--   d1  products whose sku contains a lowercase letter
--   d2  SKU values equal ignoring case (potential collisions), one row per group
--   d3  products whose (sku, name) pair is equal ignoring case to another row.
--       Not asked for. These are the rows a case normalise on name would push
--       into products_sku_name_key, so it is shown before anyone writes one
--   e1  purchase_order_items.description, the a1 test, count only
--   e2  purchase_order_items.description, the a2 test, count only
--   e3  sales_order_items.description, the a1 test, count only
--   e4  sales_order_items.description, the a2 test, count only
--
-- THE TESTS.
--   First letter (a1, c1, e1, e3). The text, as stored, does not begin with A-Z
--   or 0-9. A leading space, a quote mark or a lowercase letter all count; the
--   detail column says which. NULL and blank text are skipped, not counted.
--   Words (a2, c2, e2, e4). The text is split on spaces, tabs and newlines. In
--   each word everything from the first apostrophe (straight or curly) on is
--   dropped, so the s in Mens or the t in Dont never counts. A word counts when
--   its first letter, after any leading punctuation such as an open bracket, is
--   a-z. Words that are only of, and, the, for, with, in, on, a, an or to (case
--   ignored, punctuation stripped) never count, even first in the name; a1
--   covers the first letter. The detail column lists the words that counted.
--   A row can appear under both a1 and a2.
--   Letters outside plain A-Z (accented and so on) are not tested either way.
--
-- WHAT A PASS LOOKS LIKE. An a0 row, the count rows, any listed rows, and a z0
-- row last. Zero rows means the query did not run.

begin;
set transaction read only;

with texts as (
  select 'products'::text as src, p.id::text as rid, p.sku::text as sku, p.name::text as txt, null::text as client
    from vessl.products p
  union all
  select 'quotes'::text, q.id::text, q.sku::text, q.product::text, q.client::text
    from vessl.quotes q
  union all
  select 'po_items'::text, i.id::text, null::text, i.description::text, null::text
    from vessl.purchase_order_items i
  union all
  select 'so_items'::text, s.id::text, s.client_sku::text, s.description::text, null::text
    from vessl.sales_order_items s
),
flags as (
  select t.*,
         (t.txt !~ '^[A-Z0-9]') as bad_first,
         case when left(t.txt, 1) = ' ' then 'leading space'
              when left(t.txt, 1) ~ '^[a-z]' then 'starts lowercase'
              else 'starts with ' || left(t.txt, 1) end as first_note,
         (select string_agg(x.word, ' ')
            from regexp_split_to_table(t.txt, '[ ' || chr(9) || chr(10) || chr(13) || ']+') as x(word)
           where regexp_replace(x.word, '[' || chr(39) || chr(8217) || '].*$', '') ~ '^[^A-Za-z0-9]*[a-z]'
             and lower(regexp_replace(regexp_replace(x.word, '[' || chr(39) || chr(8217) || '].*$', ''), '[^A-Za-z]', '', 'g'))
                 not in ('of', 'and', 'the', 'for', 'with', 'in', 'on', 'a', 'an', 'to')) as low_words
    from texts t
   where coalesce(btrim(t.txt), '') <> ''
),
sku_groups as (
  select lower(p.sku) as k, count(*) as n_rows, string_agg(distinct p.sku, ' / ') as variants
    from vessl.products p
   where p.sku is not null
   group by lower(p.sku)
  having count(distinct p.sku) > 1
),
pair_groups as (
  select lower(coalesce(p.sku, '')) as ks, lower(p.name) as kn, count(*) as n_rows,
         string_agg(coalesce(p.sku, 'no sku') || ' | ' || p.name || ' | ' || p.id::text, ' / ' order by p.id::text) as variants
    from vessl.products p
   where p.name is not null
   group by lower(coalesce(p.sku, '')), lower(p.name)
  having count(*) > 1
)
select * from (
  select 'a0 audit ran, read only, nothing changes'::text as chk, 'shown'::text as got, 'always'::text as want,
         null::text as row_id, null::text as sku, null::text as name, null::text as client, null::text as detail
  union all
  -- a. products, first letter
  select 'a1 count, products whose name does not start uppercase or digit'::text,
         (select count(*)::text from flags where src = 'products' and bad_first), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'a1 row'::text, null::text, null::text, rid, sku, txt, null::text, first_note::text
    from flags where src = 'products' and bad_first
  union all
  -- b. products, Title Case candidates
  select 'a2 count, products with a word starting lowercase'::text,
         (select count(*)::text from flags where src = 'products' and low_words is not null), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'a2 row'::text, null::text, null::text, rid, sku, txt, null::text, low_words::text
    from flags where src = 'products' and low_words is not null
  union all
  -- c. quotes.product, both tests
  select 'c1 count, quotes whose product does not start uppercase or digit'::text,
         (select count(*)::text from flags where src = 'quotes' and bad_first), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'c1 row'::text, null::text, null::text, rid, sku, txt, client, first_note::text
    from flags where src = 'quotes' and bad_first
  union all
  select 'c2 count, quotes with a product word starting lowercase'::text,
         (select count(*)::text from flags where src = 'quotes' and low_words is not null), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'c2 row'::text, null::text, null::text, rid, sku, txt, client, low_words::text
    from flags where src = 'quotes' and low_words is not null
  union all
  -- d. SKUs
  select 'd1 count, products whose sku contains a lowercase letter'::text,
         (select count(*)::text from vessl.products where sku ~ '[a-z]'), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'd1 row'::text, null::text, null::text, p.id::text, p.sku::text, p.name::text, null::text, null::text
    from vessl.products p where p.sku ~ '[a-z]'
  union all
  select 'd2 count, SKU values equal ignoring case'::text,
         (select count(*)::text from sku_groups), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'd2 row'::text, n_rows::text || ' rows', null::text, null::text, k::text, null::text, null::text, variants::text
    from sku_groups
  union all
  select 'd3 count, (sku, name) pairs equal ignoring case'::text,
         (select count(*)::text from pair_groups), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'd3 row'::text, n_rows::text || ' rows', null::text, null::text, ks::text, kn::text, null::text, variants::text
    from pair_groups
  union all
  -- e. order lines, counts only, these will not be changed
  select 'e1 count, PO lines whose description does not start uppercase or digit'::text,
         (select count(*)::text from flags where src = 'po_items' and bad_first), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'e2 count, PO lines with a description word starting lowercase'::text,
         (select count(*)::text from flags where src = 'po_items' and low_words is not null), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'e3 count, SO lines whose description does not start uppercase or digit'::text,
         (select count(*)::text from flags where src = 'so_items' and bad_first), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'e4 count, SO lines with a description word starting lowercase'::text,
         (select count(*)::text from flags where src = 'so_items' and low_words is not null), 'report'::text,
         null::text, null::text, null::text, null::text, null::text
  union all
  select 'z0 verification ran, rows tested = '
           || (select count(*)::text from flags) || ' of ' || (select count(*)::text from texts),
         'shown'::text, 'always'::text, null::text, null::text, null::text, null::text, null::text
) r
order by chk, name, row_id;

-- Read only from top to bottom. Nothing to commit.
rollback;
