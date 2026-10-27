-- 103r -- Reverse 103. Quotes lose their Quote ID.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 103. One transaction.
--
-- WHAT IT DOES. Drops trg_quote_code, vessl.assign_quote_code(), the two
-- constraints, the quote_code column and vessl.quote_code_seq. No other column of
-- any quote is written; quote_num is left exactly as it is.
--
-- THE CODES ARE GONE AFTER THIS. Anything that quoted one -- a note, an email, a
-- PLM card (script 104 stores the quote by its uuid, not its code, so a card is
-- unaffected) -- names a code that no longer exists. Running 103 again numbers
-- the same quotes in the same order, so the codes would come back the same
-- while no quote has been deleted in between. Take the code that shows the ID out
-- of the app first.
--
-- GUARDS. The column, the sequence, the function and the trigger all exist,
-- which proves 103 ran.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre103r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'quote_code')     as has_col,
    (to_regclass('vessl.quote_code_seq') is not null)::text                                      as has_seq,
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'vessl' and p.proname = 'assign_quote_code')                             as has_fn,
    (select count(*) from pg_trigger
      where tgrelid = 'vessl.quotes'::regclass and tgname = 'trg_quote_code')                    as has_trg,
    (select count(*) from vessl.quotes)                                                          as n_quotes,
    (select md5(coalesce(string_agg((to_jsonb(q) - 'quote_code')::text, '/' order by q.id), '')) from vessl.quotes q) as h_rest;

do $guard$
begin
  if (select has_col from _pre103r) <> 1 or (select has_seq from _pre103r) <> 'true'
     or (select has_fn from _pre103r) <> 1 or (select has_trg from _pre103r) <> 1 then
    raise exception 'quote_code, its sequence, function or trigger is missing, so 103 is not in place, nothing changed';
  end if;
end
$guard$;

drop trigger trg_quote_code on vessl.quotes;
drop function vessl.assign_quote_code();
alter table vessl.quotes drop constraint quotes_quote_code_shape;
alter table vessl.quotes drop constraint quotes_quote_code_key;
alter table vessl.quotes drop column quote_code;
drop sequence vessl.quote_code_seq;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 column, sequence, function and trigger all existed' as chk,
         (select has_col::text || '/' || has_seq || '/' || has_fn::text || '/' || has_trg::text from _pre103r) as got,
         '1/true/1/1' as want
  union all
  select 'b1 all four are gone',
         ((select count(*) from information_schema.columns
            where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'quote_code')::text
          || '/' || (to_regclass('vessl.quote_code_seq') is null)::text
          || '/' || (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'vessl' and p.proname = 'assign_quote_code')::text
          || '/' || (select count(*) from pg_trigger where tgrelid = 'vessl.quotes'::regclass and not tgisinternal)::text),
         '0/true/0/0'
  union all
  select 'b2 the same quotes, every other column unchanged, quote_num included',
         (select (count(*) = p.n_quotes)::text || '/'
                 || (md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) = p.h_rest)::text
            from vessl.quotes q, _pre103r p group by p.n_quotes, p.h_rest),
         'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
