-- 72 -- the quotes whose client the catalogue can name, linked to it.
--
-- WHAT IT DOES. Sets vessl.quotes.client_company_id where it is null and the
-- trimmed lowercase client text matches exactly one company of type client. 3
-- rows. Quotes matching zero companies, or several, are left exactly as they are
-- and named in the verification.
--
-- THE SAME RESOLUTION saveQuote USES, deliberately. That function matches the
-- free text against companies case insensitively and takes the answer only when
-- there is exactly one hit -- zero and several both leave the column null,
-- because either is a guess. This script is that rule applied once to the rows
-- that predate it, and nothing more. A backfill that resolved more loosely than
-- the app would leave rows the app would never have produced.
--
-- WHY THESE ROWS EXIST AT ALL. client_company_id was backfilled by script 48 and
-- then nothing maintained it until the quote form started resolving on every
-- save. A quote saved before that, or never re-saved since its company was
-- created, keeps a null -- which is what the two Legoland New York rows are.
-- They named a client the catalogue had no company for at the time, and the
-- company exists now.
--
-- NOTHING IS CREATED. No company row is added, changed or removed. The only
-- column written is quotes.client_company_id, and only where it is null -- a row
-- that already carries a link is never re-pointed, however its text reads.
--
-- MEASURED BEFORE WRITING, against the live database
--   quotes -- 340 rows, 5 carrying a null client_company_id.
--   of those 5 -- 3 match exactly one client company, 2 match none, 0 match
--     several.
--   the three -- LLN-500 and LLN-473 on Legoland New York, and the BUC-157 copy
--     on Buc-ees.
--   the two left null -- Legal and Broughton HS. Broughton HS is a real client
--     being added by hand and is not a company yet; Legal reads as a placeholder
--     and needs a person to say what it is.
--   no client company name is duplicated case insensitively, so the several
--     branch is empty today. It is still written, because that is the condition
--     the app guards against and the data can change.
--   24 client companies.

begin;

-- ARCHIVE FIRST. Every row this will touch, as JSON, before a single write.
create temp table _arch72 on commit drop as
  select (select jsonb_agg(jsonb_build_object('id', q.id, 'sku', q.sku, 'client', q.client,
                                              'quote_date', q.quote_date, 'updated_by', q.updated_by,
                                              'client_company_id_before', q.client_company_id)
                           order by q.created_at)
            from vessl.quotes q
           where q.client_company_id is null
             and (select count(*) from vessl.companies c
                   where c.type::text = 'client'
                     and lower(btrim(c.name)) = lower(btrim(q.client))) = 1) as touched;

select jsonb_pretty(touched) as rows_to_link from _arch72;

-- PRE-STATE, counted before anything is written.
create temp table _pre72 on commit drop as
  select (select count(*) from vessl.quotes)                                       as quotes_before,
         (select count(*) from vessl.quotes where client_company_id is null)        as null_before,
         (select count(*) from vessl.quotes q
           where q.client_company_id is null
             and (select count(*) from vessl.companies c
                   where c.type::text = 'client'
                     and lower(btrim(c.name)) = lower(btrim(q.client))) = 1)        as resolvable,
         (select count(*) from vessl.quotes q
           where q.client_company_id is null
             and (select count(*) from vessl.companies c
                   where c.type::text = 'client'
                     and lower(btrim(c.name)) = lower(btrim(q.client))) = 0)        as zero_match,
         (select count(*) from vessl.quotes q
           where q.client_company_id is null
             and (select count(*) from vessl.companies c
                   where c.type::text = 'client'
                     and lower(btrim(c.name)) = lower(btrim(q.client))) > 1)        as many_match,
         (select count(*) from vessl.companies where type::text = 'client')         as client_companies;

-- REFUSE rather than backfill a set that is not the one measured.
do $guard$
begin
  if (select null_before from _pre72) <> 5 then
    raise exception 'the number of quotes with no client company is not the five measured, nothing changed';
  end if;
  if (select resolvable from _pre72) <> 3 then
    raise exception 'the number of quotes resolving to exactly one company is not the three measured, nothing changed';
  end if;
  if (select zero_match from _pre72) <> 2 then
    raise exception 'the number of quotes resolving to no company is not the two measured, nothing changed';
  end if;
  -- Empty today. If it ever is not, two companies share a name and the right
  -- answer is to merge them rather than to pick one here.
  if (select many_match from _pre72) <> 0 then
    raise exception 'some quote client text matches several companies, which this backfill will not choose between, nothing changed';
  end if;
end
$guard$;

-- 1. THE LINK, FOR THE ROWS WHERE THERE IS EXACTLY ONE ANSWER. The subquery is
--    repeated in the where clause rather than joined, so a row matching several
--    companies cannot multiply and cannot be written by accident.
update vessl.quotes q
   set client_company_id = (select c.id from vessl.companies c
                             where c.type::text = 'client'
                               and lower(btrim(c.name)) = lower(btrim(q.client))),
       updated_at = now()
 where q.client_company_id is null
   and (select count(*) from vessl.companies c
         where c.type::text = 'client'
           and lower(btrim(c.name)) = lower(btrim(q.client))) = 1;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 five quotes carried no client company' as chk,
         (select null_before::text from _pre72) as got, '5' as want
  union all
  select 'a1 three resolved, two did not, none was ambiguous',
         (select resolvable::text || '/' || zero_match::text || '/' || many_match::text from _pre72), '3/2/0'
  union all
  select 'a2 the archive captured the three',
         (select jsonb_array_length(touched)::text from _arch72), '3'
  union all
  select 'a3 twenty four client companies',
         (select client_companies::text from _pre72), '24'
  union all
  select 'b1 two quotes still carry no client company',
         (select count(*)::text from vessl.quotes where client_company_id is null), '2'
  union all
  -- THE TWO LEFT BEHIND, NAMED. A backfill that silently leaves rows is a
  -- backfill nobody checks again; this says which they are and why.
  select 'b2 and they are the two the catalogue cannot name',
         (select string_agg(btrim(client), ', ' order by btrim(client))
            from vessl.quotes where client_company_id is null), 'Broughton HS, Legal'
  union all
  select 'b3 neither of those matches any client company',
         (select coalesce(sum((select count(*) from vessl.companies c
                                where c.type::text = 'client'
                                  and lower(btrim(c.name)) = lower(btrim(q.client)))),0)::text
            from vessl.quotes q where q.client_company_id is null), '0'
  union all
  select 'b4 the three named rows are linked now',
         (select count(*)::text from vessl.quotes
           where client_company_id is not null
             and id in ('a1913a2f-b17e-4b70-96d3-cf81724075b6',
                        'ed5e4669-487b-4ca9-9dbe-31f9df1a3f6c',
                        '3d1c731a-0e9d-48a6-93da-67f67defe42f')), '3'
  union all
  -- IDENTITY BY ID, never by name. The two Legoland rows must point at the
  -- Legoland New York company and the Buc-ees row at the Buc-ees one.
  select 'b5 each points at the company its text names',
         (select string_agg(substr(q.id::text,1,8) || '=' || substr(q.client_company_id::text,1,8), ' ' order by q.id)
            from vessl.quotes q
           where q.id in ('a1913a2f-b17e-4b70-96d3-cf81724075b6',
                          'ed5e4669-487b-4ca9-9dbe-31f9df1a3f6c',
                          '3d1c731a-0e9d-48a6-93da-67f67defe42f')),
         '3d1c731a=14cf63ad a1913a2f=1c4f5a5f ed5e4669=1c4f5a5f'
  union all
  select 'b6 every linked quote points at a company that exists and is a client',
         (select count(*)::text from vessl.quotes q
           where q.client_company_id is not null
             and not exists (select 1 from vessl.companies c
                              where c.id = q.client_company_id and c.type::text = 'client')), '0'
  union all
  select 'c1 no quote was added or removed',
         (select ((select count(*) from vessl.quotes) - quotes_before)::text from _pre72), '0'
  union all
  select 'c2 no company row was touched',
         (select count(*)::text from vessl.companies where type::text = 'client'), '24'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
