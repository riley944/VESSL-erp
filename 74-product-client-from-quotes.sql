-- 74 -- the products that only ever belonged to one client, linked to it.
--
-- WHAT IT DOES. Sets vessl.products.client_company_id where it is null and every
-- quote on that product resolves to the same single client company. 72 rows.
-- Products whose quotes disagree, whose quotes resolve to nobody, or which have
-- no quote at all are left exactly as they are and counted in the verification.
--
-- WHY THESE ROWS EXIST. ensureProductForQuote minted a product from a quote and
-- wrote sku, name and origin, and nothing else. The client was known at that
-- moment and thrown away. The code change shipping alongside this script passes
-- it on the insert, so this is that rule applied once to the rows that predate
-- it, and nothing more.
--
-- THE STRICT READING, DELIBERATELY. Every quote on the product must carry a
-- resolved client, and they must all name the same one. A product carrying a mix
-- of resolved and unresolved quotes would be a judgement call about whether
-- silence agrees with the others. It happens that there are ZERO such products
-- today, so the strict rule and the lenient one select the same 72 rows -- but
-- the strict one is written, because that is the condition that stays honest
-- when the data changes.
--
-- NOTHING IS OVERWRITTEN. The only column written is products.client_company_id
-- and only where it is null. A product already carrying a client keeps it,
-- whatever its quotes say -- and 12 products DO disagree with their own quotes
-- today. Those are a real question for a person and are not this script to
-- answer. b5 asserts all 12 are still there afterwards.
--
-- updated_at IS SET on the rows written, matching what script 72 did to quotes.
-- These rows were genuinely touched, and a backfill that hides that would make
-- the column a worse record than no column.
--
-- TWO FAULTS LIVED IN ONE EXPRESSION, and only the second killed the rehearsal.
-- Both are recorded, because the first looks like the whole story and is not.
--
-- ONE. count(distinct x) IGNORES nulls and select distinct x does NOT, so a
-- product carrying one real client plus a quote resolving to nobody would pass
-- a count(distinct) = 1 test and then return TWO rows, one of them null. Latent
-- rather than live -- there are 0 such products today -- but wrong.
--
-- TWO, AND THE ACTUAL CAUSE. A condition sitting beside a scalar subquery in
-- the same AND chain DOES NOT GUARD IT. Postgres may evaluate the parts of a
-- where clause in any order, so count(distinct ...) = 1 does not run first just
-- because it is written first. Product LLF-1617 carries quotes naming two
-- companies, so the subquery returned two rows there and raised 21000 before
-- the count could exclude it. Filtering nulls did nothing for this, which is
-- why the second rehearsal failed exactly as the first did.
--
-- WHY THE ARCHIVE AND THE UPDATE SURVIVED. Their subqueries sit in a target
-- list and in a set clause, both evaluated only for rows that already qualified.
-- The two that failed sit IN a where clause, where nothing is ordered. All four
-- use max now, so not one of them depends on that difference.
--
-- max(x::text)::uuid RETURNS EXACTLY ONE ROW whatever the data does -- one value,
-- or null when no row matches -- so it is safe before any guard runs. Paired with
-- count(distinct) = 1 that single value IS the sole client. The null filter stays
-- beside it as a statement of intent, though max would ignore nulls on its own.
--
-- MEASURED BEFORE WRITING, against the live database
--   products -- 358 rows, 84 carrying a null client_company_id.
--   of those 84 -- 73 have at least one quote, 11 have none at all.
--   of those 73 -- 72 resolve to exactly one client, 1 has every quote
--     unresolved, and 0 have quotes that disagree with each other.
--   products already carrying a client whose quotes name a different one -- 12.
--     Untouched here by the is-null condition, and asserted below.
--   products whose quotes name SEVERAL companies -- exactly 1, LLF-1617 VIP
--     Drawstring Bag Black, quoted once to Legoland and once to Legoland
--     Florida. It already carries a client, so the backfill never considers it
--     and no branch here counts it -- but it is the row that raised 21000 twice,
--     and two names that close together read like one client recorded twice.
--     Worth a person looking, and a merge if that is what it is.

begin;

-- ARCHIVE FIRST. Every row this will touch, as JSON, before a single write.
create temp table _arch74 on commit drop as
  select (select jsonb_agg(jsonb_build_object('id', p.id, 'sku', p.sku, 'name', p.name,
                                              'origin', p.origin,
                                              'client_company_id_before', p.client_company_id,
                                              'client_company_id_after',
                                                (select max(q.client_company_id::text)::uuid
                                                   from vessl.quotes q where q.product_id = p.id
                                                    and q.client_company_id is not null),
                                              'quote_rows',
                                                (select count(*) from vessl.quotes q where q.product_id = p.id))
                           order by p.sku)
            from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
             and (select count(*) from vessl.quotes q
                   where q.product_id = p.id and q.client_company_id is null) = 0
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1) as touched;

select jsonb_pretty(touched) as rows_to_link from _arch74;

-- PRE-STATE, counted before anything is written.
create temp table _pre74 on commit drop as
  select (select count(*) from vessl.products)                                    as products_before,
         (select count(*) from vessl.products where client_company_id is null)    as null_before,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0) as null_with_quotes,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) = 0) as null_no_quotes,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
             and (select count(*) from vessl.quotes q
                   where q.product_id = p.id and q.client_company_id is null) = 0
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1)                                as backfillable,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) > 1)                                as conflicting,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 0)                                as all_quotes_unresolved,
         (select count(*) from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
             and (select count(*) from vessl.quotes q
                   where q.product_id = p.id and q.client_company_id is null) > 0
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1)                                as one_client_some_silent,
         (select count(*) from vessl.products p
           where p.client_company_id is not null
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1
             and (select max(q.client_company_id::text)::uuid from vessl.quotes q
                   where q.product_id = p.id
                     and q.client_company_id is not null) is distinct from p.client_company_id) as already_disagreeing;

-- REFUSE rather than backfill a set that is not the one measured.
do $guard$
begin
  if (select null_before from _pre74) <> 84 then
    raise exception 'the number of products with no client is not the 84 measured, nothing changed';
  end if;
  if (select backfillable from _pre74) <> 72 then
    raise exception 'the number of products resolving to exactly one client is not the 72 measured, nothing changed';
  end if;
  if (select null_no_quotes from _pre74) <> 11 then
    raise exception 'the number of products with no quote at all is not the 11 measured, nothing changed';
  end if;
  if (select all_quotes_unresolved from _pre74) <> 1 then
    raise exception 'the number of products whose every quote is unresolved is not the 1 measured, nothing changed';
  end if;
  -- Empty today. If it ever is not, a product has been quoted to two clients and
  -- the right answer is a person deciding which one owns it, not this script.
  if (select conflicting from _pre74) <> 0 then
    raise exception 'some product carries quotes naming different clients, which this backfill will not choose between, nothing changed';
  end if;
  -- Also empty today. The strict rule and the lenient one pick the same rows only
  -- while this is zero, and the header says so.
  if (select one_client_some_silent from _pre74) <> 0 then
    raise exception 'some product mixes resolved and unresolved quotes, which the strict rule will not judge, nothing changed';
  end if;
end
$guard$;

-- 1. THE LINK, FOR THE PRODUCTS WHERE EVERY QUOTE AGREES. The conditions are
--    repeated in the where clause rather than joined, so a product whose quotes
--    disagree cannot multiply and cannot be written by accident.
update vessl.products p
   set client_company_id = (select max(q.client_company_id::text)::uuid from vessl.quotes q
                             where q.product_id = p.id
                               and q.client_company_id is not null),
       updated_at = now()
 where p.client_company_id is null
   and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
   and (select count(*) from vessl.quotes q
         where q.product_id = p.id and q.client_company_id is null) = 0
   and (select count(distinct q.client_company_id) from vessl.quotes q
         where q.product_id = p.id) = 1;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 eighty four products carried no client' as chk,
         (select null_before::text from _pre74) as got, '84' as want
  union all
  select 'a1 seventy three of those had a quote and eleven had none',
         (select null_with_quotes::text || '/' || null_no_quotes::text from _pre74), '73/11'
  union all
  select 'a2 seventy two resolved to one client, one had only unresolved quotes, none conflicted',
         (select backfillable::text || '/' || all_quotes_unresolved::text || '/' || conflicting::text from _pre74),
         '72/1/0'
  union all
  -- The strict rule and the lenient one select the same rows only while this is
  -- zero. If it is ever not, the two disagree and the header has to be reread.
  select 'a3 no product mixed resolved and unresolved quotes',
         (select one_client_some_silent::text from _pre74), '0'
  union all
  select 'a4 the archive captured the seventy two',
         (select jsonb_array_length(touched)::text from _arch74), '72'
  union all
  select 'b1 twelve products still carry no client',
         (select count(*)::text from vessl.products where client_company_id is null), '12'
  union all
  -- THE TWELVE LEFT BEHIND, BROKEN DOWN. A backfill that silently leaves rows is
  -- a backfill nobody checks again.
  -- Stated as the two groups rather than their total, which would only restate
  -- b1 and could never fail on its own.
  select 'b2 and they are the eleven with no quote plus the one with no resolved quote',
         (select count(*)::text from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) = 0) || '/' ||
         (select count(*)::text from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0), '11/1'
  union all
  select 'b3 nothing is left that this rule could have linked',
         (select count(*)::text from vessl.products p
           where p.client_company_id is null
             and (select count(*) from vessl.quotes q where q.product_id = p.id) > 0
             and (select count(*) from vessl.quotes q
                   where q.product_id = p.id and q.client_company_id is null) = 0
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1), '0'
  union all
  select 'b4 every product written points at a company that exists and is a client',
         (select count(*)::text from vessl.products p
           where p.client_company_id is not null
             and not exists (select 1 from vessl.companies c
                              where c.id = p.client_company_id and c.type::text = 'client')), '0'
  union all
  -- IDENTITY BY ID, never by name, and read back from the archive rather than
  -- recomputed -- so this compares what was written against what was promised.
  select 'b5 each written product carries the client its archive row named',
         (select count(*)::text from jsonb_array_elements((select touched from _arch74)) a
            join vessl.products p on p.id = (a.value->>'id')::uuid
           where p.client_company_id is distinct from (a.value->>'client_company_id_after')::uuid), '0'
  union all
  -- THE DISAGREEMENTS ARE NOT THIS SCRIPT TO FIX, and this proves it did not.
  select 'b6 the twelve products that already disagreed with their quotes are untouched',
         (select already_disagreeing::text from _pre74) || '/' ||
         (select count(*)::text from vessl.products p
           where p.client_company_id is not null
             and (select count(distinct q.client_company_id) from vessl.quotes q
                   where q.product_id = p.id) = 1
             and (select max(q.client_company_id::text)::uuid from vessl.quotes q
                   where q.product_id = p.id
                     and q.client_company_id is not null) is distinct from p.client_company_id), '12/12'
  union all
  select 'c1 no product was added or removed',
         (select ((select count(*) from vessl.products) - products_before)::text from _pre74), '0'
  union all
  -- One, not the two script 72 left behind. Broughton HS was a real client being
  -- added by hand at the time and is a company now, which is why the client
  -- company count is 25 rather than the 24 that script measured. Legal is still
  -- the one row nobody has answered.
  select 'c2 no quote row was touched',
         (select count(*)::text from vessl.quotes where client_company_id is null), '1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
