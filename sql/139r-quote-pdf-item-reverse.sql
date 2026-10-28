-- 139r -- Reverse of 139. Quotes without pdf_item.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- once Save of an imported quote names pdf_item, it
-- fails as soon as the column is gone.
--
-- WHAT IT DOES. Drops the CHECK quotes_pdf_item_object and quotes.pdf_item,
-- losing whichever items were recorded (a0 counts them). The PDF itself and
-- pdf_path are not touched. No other column, no other row.
--
-- GUARDS, before any change.
--   pdf_item exists (139 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_item') <> 1 then
    raise exception 'quotes.pdf_item is not there, so 139 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre139r on commit drop as
  select
    (select count(pdf_item) from vessl.quotes)                                                   as n_set,
    (select count(*) from vessl.quotes)                                                          as n_q,
    -- Every row, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(q) - 'pdf_item')::text, '/' order by q.id), ''))
       from vessl.quotes q)                                                                      as h_q;

alter table vessl.quotes drop constraint if exists quotes_pdf_item_object;
alter table vessl.quotes drop column pdf_item;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, items lost = ' || (select n_set::text from _pre139r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 pdf_item and its CHECK are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_item')
           || '/' || (select count(*)::text from pg_constraint
                       where conrelid = 'vessl.quotes'::regclass and conname = 'quotes_pdf_item_object'),
         '0/0'::text
  union all
  select 'b2 every other quote column unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
                           = (select h_q from _pre139r) then 'same' else 'changed' end
            from vessl.quotes q),
         'same'::text
  union all
  select 'b3 same number of rows',
         (select count(*)::text from vessl.quotes),
         (select n_q::text from _pre139r)
  union all
  select 'z0 verification ran, quotes = ' || (select count(*)::text from vessl.quotes),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
