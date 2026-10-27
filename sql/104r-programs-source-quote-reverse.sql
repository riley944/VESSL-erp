-- 104r -- Reverse 104. PLM cards stop remembering their source quote.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 104. One transaction.
--
-- WHAT IT DOES. Drops the index, the foreign key and programs.source_quote_id.
-- No other column of any card is written, and no quote is touched.
--
-- WHAT IS LOST. Which quote each card came from -- r1 says how many cards had
-- one. A card still exists and still sits where it was; it just stops saying
-- "From quote Q-...". Take the code that shows and writes it out of the app first.
--
-- GUARDS. The column, the key and the index all exist, which proves 104 ran.
--
-- WHAT A PASS LOOKS LIKE. r1 plus z0. Any a or b row is a failed check.

begin;

create temp table _pre104r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'programs' and column_name = 'source_quote_id') as has_col,
    (select count(*) from pg_constraint
      where conrelid = 'vessl.programs'::regclass and conname = 'programs_source_quote_id_fkey')       as has_fkey,
    (select count(*) from pg_indexes
      where schemaname = 'vessl' and indexname = 'programs_source_quote_id_idx')                        as has_idx,
    (select count(*) from vessl.programs)                                                              as n_cards,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), '')) from vessl.programs p) as h_rest;

-- How many cards named a quote, read through to_jsonb so this parses whether or
-- not the column exists.
create temp table _named104r on commit drop as
  select count(*) as n from vessl.programs p where (to_jsonb(p) ->> 'source_quote_id') is not null;

do $guard$
begin
  if (select has_col from _pre104r) <> 1 or (select has_fkey from _pre104r) <> 1 or (select has_idx from _pre104r) <> 1 then
    raise exception 'source_quote_id, its key or its index is missing, so 104 is not in place, nothing changed';
  end if;
end
$guard$;

drop index vessl.programs_source_quote_id_idx;
alter table vessl.programs drop constraint programs_source_quote_id_fkey;
alter table vessl.programs drop column source_quote_id;

-- VERIFICATION. r1 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r1 cards that named a source quote, now no longer recorded' as chk,
         (select n::text from _named104r) as got,
         'shown every run' as want
  union all
  select 'a0 column, key and index existed',
         (select has_col::text || '/' || has_fkey::text || '/' || has_idx::text from _pre104r), '1/1/1'
  union all
  select 'b1 all three are gone',
         ((select count(*) from information_schema.columns
            where table_schema = 'vessl' and table_name = 'programs' and column_name = 'source_quote_id')::text
          || '/' || (select count(*) from pg_constraint
                      where conrelid = 'vessl.programs'::regclass and conname = 'programs_source_quote_id_fkey')::text
          || '/' || (select count(*) from pg_indexes
                      where schemaname = 'vessl' and indexname = 'programs_source_quote_id_idx')::text),
         '0/0/0'
  union all
  select 'b2 the same cards, every other column unchanged',
         (select (count(*) = x.n_cards)::text || '/'
                 || (md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) = x.h_rest)::text
            from vessl.programs p, _pre104r x group by x.n_cards, x.h_rest),
         'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
