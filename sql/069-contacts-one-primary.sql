-- 69 -- one primary contact per company, and every company that has contacts has one.
--
-- WHAT IT DOES. Demotes every primary contact except the oldest where a company
-- carries more than one, and promotes the oldest contact where a company carries
-- none. Touches vessl.contacts.is_primary and nothing else.
--
-- WHY THE DATA DRIFTED. is_primary was a free checkbox on the company card, so
-- ticking one contact never cleared the others, and BOTH automated insert paths
-- hardcoded it true -- the create-company modal and the contact save on the quote
-- form. Both of those are upserts on the company, so adopting a company that
-- already had contacts added a second primary to it. The app change that ships
-- with this script makes the control a radio and makes the two insert paths ask
-- whether the company already has somebody.
--
-- WHY IT MATTERS RATHER THAN BEING UNTIDY. Two readers answer the question who is
-- the contact here, and both take the FIRST row flagged primary -- the company
-- card and the export column. With several flagged, the answer was whichever row
-- the query happened to return first, which is not a decision anybody made.
--
-- OLDEST WINS, AND THE TIE BREAK EARNS ITS PLACE. Order is created_at then id.
-- The contacts loaded in the bulk import of 2026-06-04 all carry an identical
-- timestamp, so created_at alone cannot order them and id is what decides. The
-- app uses the same order when it promotes after a removal.
--
-- MEASURED BEFORE WRITING, against the live database
--   contacts -- 30 rows across 17 companies. No row has a null company_id and no
--     row has a null is_primary, so neither needs a guard.
--   18 rows flagged primary, 12 not.
--   3 companies carry MORE THAN ONE primary -- Buc-ees with 2, Legoland with 4,
--     Peppa Pig with 2 -- which is 5 rows to demote.
--   4 companies carry contacts and NO primary -- BucketGolf, Johnnie-O, Madame
--     Tussauds, Ritz Carlton -- which is 4 rows to promote.
--   18 minus 5 plus 4 is 17, one for each company that has contacts.

begin;

-- ARCHIVE FIRST, before anything is written. Every row this script will touch, as
-- JSON, so the before state is recoverable from the transcript alone.
create temp table _arch69 on commit drop as
  select (select jsonb_agg(to_jsonb(ct) order by ct.company_id, ct.created_at, ct.id)
            from vessl.contacts ct
           where ct.id in (
             select s.id from (
               select c2.id,
                      row_number() over (partition by c2.company_id order by c2.created_at, c2.id) as rn
                 from vessl.contacts c2
                where c2.company_id is not null and coalesce(c2.is_primary,false)
             ) s where s.rn > 1))                                        as to_demote,
         (select jsonb_agg(to_jsonb(ct) order by ct.company_id)
            from vessl.contacts ct
           where ct.id in (
             select distinct on (c3.company_id) c3.id
               from vessl.contacts c3
              where c3.company_id is not null
                and not exists (select 1 from vessl.contacts p
                                 where p.company_id = c3.company_id
                                   and coalesce(p.is_primary,false))
              order by c3.company_id, c3.created_at, c3.id))             as to_promote;

select jsonb_pretty(to_demote)  as rows_to_demote,
       jsonb_pretty(to_promote) as rows_to_promote
  from _arch69;

-- PRE-STATE, counted before anything is written.
create temp table _pre69 on commit drop as
  select (select count(*) from vessl.contacts)                                     as contacts_before,
         (select count(distinct company_id) from vessl.contacts
           where company_id is not null)                                           as companies_with_contacts,
         (select count(*) from vessl.contacts where coalesce(is_primary,false))    as primaries_before,
         (select count(*) from (select company_id from vessl.contacts
                                 where company_id is not null and coalesce(is_primary,false)
                                 group by 1 having count(*) > 1) s)                as multi_primary_companies,
         (select coalesce(sum(n - 1),0) from (select count(*) as n from vessl.contacts
                                               where company_id is not null and coalesce(is_primary,false)
                                               group by company_id having count(*) > 1) s) as extras_to_demote,
         (select count(*) from (select company_id from vessl.contacts
                                 where company_id is not null
                                 group by 1 having bool_or(coalesce(is_primary,false)) = false) s) as no_primary_companies,
         (select count(*) from vessl.contacts where company_id is null)            as orphan_contacts,
         (select count(*) from vessl.contacts where is_primary is null)            as null_primary;

-- REFUSE rather than repair a shape that is not the one measured.
do $guard$
begin
  if (select contacts_before from _pre69) <> 30 then
    raise exception 'contacts is not the thirty row table measured, nothing changed';
  end if;
  if (select multi_primary_companies from _pre69) <> 3 then
    raise exception 'the number of companies carrying several primaries is not the three measured, nothing changed';
  end if;
  if (select extras_to_demote from _pre69) <> 5 then
    raise exception 'the number of extra primaries is not the five measured, nothing changed';
  end if;
  if (select no_primary_companies from _pre69) <> 4 then
    raise exception 'the number of companies with contacts and no primary is not the four measured, nothing changed';
  end if;
  -- Both are zero today, so neither branch below has to think about a null. If
  -- that ever stops being true the repair needs rewriting rather than running.
  if (select orphan_contacts from _pre69) <> 0 then
    raise exception 'some contact carries no company, which this repair does not handle, nothing changed';
  end if;
  if (select null_primary from _pre69) <> 0 then
    raise exception 'some contact carries a null is_primary, which this repair does not handle, nothing changed';
  end if;
end
$guard$;

-- 1. DEMOTE EVERY PRIMARY BUT THE OLDEST. row_number over the primaries alone, so
--    the row kept is the oldest one already flagged rather than the oldest contact
--    -- a company that chose a later contact as its primary keeps that choice, and
--    only the duplicates go.
update vessl.contacts
   set is_primary = false,
       updated_at = now()
 where id in (
   select s.id from (
     select c2.id,
            row_number() over (partition by c2.company_id order by c2.created_at, c2.id) as rn
       from vessl.contacts c2
      where c2.company_id is not null and coalesce(c2.is_primary,false)
   ) s where s.rn > 1
 );

-- 2. PROMOTE THE OLDEST CONTACT WHERE A COMPANY HAS NONE. Runs after the demote,
--    and the NOT EXISTS is evaluated then -- so the three companies repaired above
--    already hold exactly one primary and are correctly skipped here.
update vessl.contacts
   set is_primary = true,
       updated_at = now()
 where id in (
   select distinct on (c3.company_id) c3.id
     from vessl.contacts c3
    where c3.company_id is not null
      and not exists (select 1 from vessl.contacts p
                       where p.company_id = c3.company_id
                         and coalesce(p.is_primary,false))
    order by c3.company_id, c3.created_at, c3.id
 );

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 thirty contacts across seventeen companies' as chk,
         (select contacts_before::text || '/' || companies_with_contacts::text from _pre69) as got, '30/17' as want
  union all
  select 'a1 three companies carried several primaries, five rows over',
         (select multi_primary_companies::text || '/' || extras_to_demote::text from _pre69), '3/5'
  union all
  select 'a2 four companies carried contacts and no primary',
         (select no_primary_companies::text from _pre69), '4'
  union all
  select 'a3 eighteen rows were flagged primary before',
         (select primaries_before::text from _pre69), '18'
  union all
  -- THE ARCHIVE IS PART OF THE PASS. A repair whose archive missed the rows it
  -- changed is a repair with no way back.
  select 'a4 both sets were archived, five and four',
         (select jsonb_array_length(to_demote)::text || '/' || jsonb_array_length(to_promote)::text
            from _arch69), '5/4'
  union all
  select 'b1 no company carries more than one primary now',
         (select count(*)::text from (select company_id from vessl.contacts
                                       where company_id is not null and coalesce(is_primary,false)
                                       group by 1 having count(*) > 1) s), '0'
  union all
  select 'b2 no company carries contacts without a primary now',
         (select count(*)::text from (select company_id from vessl.contacts
                                       where company_id is not null
                                       group by 1 having bool_or(coalesce(is_primary,false)) = false) s), '0'
  union all
  -- THE INVARIANT ITSELF, stated as a count rather than as two absences.
  select 'b3 every company with contacts has exactly one primary',
         (select count(*)::text from (select company_id from vessl.contacts
                                       where company_id is not null
                                       group by 1
                                      having count(*) filter (where coalesce(is_primary,false)) = 1) s), '17'
  union all
  select 'b4 seventeen rows are flagged primary now',
         (select count(*)::text from vessl.contacts where coalesce(is_primary,false)), '17'
  union all
  -- IDENTITY BY ID, never by name. These are the three rows that had to survive
  -- as primary, one per company that carried several.
  select 'b5 the oldest primary of each crowded company kept the flag',
         (select string_agg((case when coalesce(is_primary,false) then 'kept' else 'LOST' end), ',' order by id)
            from vessl.contacts
           where id in ('39b2a156-efbb-4060-b0fc-a95022e0d0de',
                        'ddf7ed03-b8fe-4752-9f9a-01c89c570875',
                        '0a5a12f7-f3e5-4aa7-9d9c-7e1229b0e596')), 'kept,kept,kept'
  union all
  select 'b6 the five duplicates are no longer primary',
         (select count(*)::text from vessl.contacts
           where coalesce(is_primary,false)
             and id in ('a35c63b9-3072-4769-8dea-574f3c07c753',
                        '32559092-d024-4f01-9534-ccb8e1dc08b8',
                        'a1e72348-cddb-4eff-b4bf-61abc5d0c683',
                        'ae1cf3d8-3958-4b86-87e8-1b13a584d0f6',
                        '2be226d0-df9e-4121-98b9-3a0aa6f53162')), '0'
  union all
  select 'b7 the four promoted rows are primary',
         (select count(*)::text from vessl.contacts
           where coalesce(is_primary,false)
             and id in ('4a31047b-6813-4548-9aaf-c25bbcae2e6b',
                        '4d380aa8-e8ca-4d75-8653-079b0d7e7d3d',
                        '87ee369a-518c-4ca8-83ff-96a7567744f8',
                        '794d5825-3a2b-4d69-83d3-dbaf9694a876')), '4'
  union all
  select 'c1 no contact was added or removed',
         (select ((select count(*) from vessl.contacts) - contacts_before)::text from _pre69), '0'
  union all
  select 'c2 the same seventeen companies still have contacts',
         (select count(distinct company_id)::text from vessl.contacts where company_id is not null), '17'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
