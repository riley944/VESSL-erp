-- 71 -- three spellings of three factories become the names the companies carry.
--
-- WHAT IT DOES. Re-points vessl.quotes.factory for three strings that name a
-- company the catalogue already holds under a slightly different spelling. 52
-- rows across three aliases. Nothing else is touched.
--
--   LIAONING KANGPING PLASTIC INDUSTRY CO.,LTD  44 rows  the company name without
--                                                        the space after the comma
--   Aung crown                                   7 rows  a small c
--   Baoquan                                      1 row   shorthand
--
-- WHY NOW. The quote form has stopped accepting free text in the factory box --
-- it is a closed select over the factory companies, the same shape the HTS field
-- has. A stored name that matches no company still DISPLAYS, by the structural
-- rule that picker carries, so nothing breaks and nothing is erased. But 52
-- quotes reading as unmatched is 52 quotes whose factory the app cannot resolve
-- to a company, and all three of these are spellings rather than unknown firms.
--
-- THE SAFETY NET STAYS EITHER WAY. FACTORY_ALIASES in the Companies export folds
-- two of these three when it builds the factory list. That stays after this runs.
-- It costs nothing, and it is what catches the same spelling arriving again from
-- an older quote or an import.
--
-- SPELLING ONLY, NEVER A MERGE. Every target is a company that already exists,
-- and no company row is created, changed or removed here. The only column written
-- is quotes.factory, and the only rows written are the 52 that hold one of the
-- three strings exactly, trimmed and case insensitively.
--
-- MEASURED BEFORE WRITING, against the live database
--   quotes -- 340 rows, 337 of them carrying a factory text, 9 distinct strings.
--   the distinct count ends on EIGHT, not six, and the first rehearsal caught the
--     wrong want here. Re-pointing an alias only removes a distinct value when
--     its target already carries quotes. Baoquan is the only one of the three
--     whose target did, with 2 -- so that one merges. The Liaoning and Aung Crown
--     targets held nothing, so those two are renames into values the set did not
--     have before. Nine, minus the one merge, is eight.
--   the three aliases -- 44, 7 and 1 rows.
--   the three targets -- 0, 0 and 2 rows already on the correct spelling.
--   all three target companies exist and are type factory.

begin;

-- ARCHIVE FIRST. Every row this will touch, as JSON, before a single write.
create temp table _arch71 on commit drop as
  select (select jsonb_agg(jsonb_build_object('id', q.id, 'factory', q.factory,
                                              'sku', q.sku, 'quote_date', q.quote_date)
                           order by q.factory, q.id)
            from vessl.quotes q
           where lower(btrim(q.factory)) in ('liaoning kangping plastic industry co.,ltd',
                                             'aung crown',
                                             'baoquan')
             and lower(btrim(q.factory)) not in ('liaoning kangping plastic industry co., ltd')) as touched;

select jsonb_pretty(touched) as rows_to_repoint from _arch71;

-- PRE-STATE, counted before anything is written.
create temp table _pre71 on commit drop as
  select (select count(*) from vessl.quotes
           where lower(btrim(factory)) = 'liaoning kangping plastic industry co.,ltd')     as alias_liaoning,
         (select count(*) from vessl.quotes where lower(btrim(factory)) = 'aung crown')    as alias_aung,
         (select count(*) from vessl.quotes where lower(btrim(factory)) = 'baoquan')       as alias_baoquan,
         (select count(*) from vessl.quotes
           where lower(btrim(factory)) = 'liaoning kangping plastic industry co., ltd')    as target_liaoning,
         (select count(*) from vessl.quotes where lower(btrim(factory)) = 'aung crown '
                                              or  btrim(factory) = 'Aung Crown')           as target_aung,
         (select count(*) from vessl.quotes
           where lower(btrim(factory)) = 'shenzhen baoquan industrial co., ltd')           as target_baoquan,
         (select count(*) from vessl.quotes)                                               as quotes_before,
         (select count(*) from vessl.quotes where coalesce(btrim(factory),'') <> '')       as with_factory_before,
         (select count(distinct lower(btrim(factory))) from vessl.quotes
           where coalesce(btrim(factory),'') <> '')                                        as distinct_before,
         (select count(*) from vessl.companies where type::text = 'factory'
           and name in ('Liaoning Kangping Plastic Industry Co., Ltd',
                        'Aung Crown',
                        'Shenzhen Baoquan Industrial Co., Ltd'))                           as targets_exist;

-- REFUSE rather than repoint a set that is not the one measured.
do $guard$
begin
  if (select alias_liaoning from _pre71) <> 44 then
    raise exception 'the Liaoning alias is not the forty four rows measured, nothing changed';
  end if;
  if (select alias_aung from _pre71) <> 7 then
    raise exception 'the Aung crown alias is not the seven rows measured, nothing changed';
  end if;
  if (select alias_baoquan from _pre71) <> 1 then
    raise exception 'the Baoquan alias is not the one row measured, nothing changed';
  end if;
  -- EVERY TARGET MUST ALREADY EXIST. This script renames text to match a company;
  -- it does not create companies, and writing a name no company carries would
  -- leave the quote exactly as unresolvable as it is now.
  if (select targets_exist from _pre71) <> 3 then
    raise exception 'the three target companies are not all present as factories, nothing changed';
  end if;
end
$guard$;

-- 1. The three re-points. Matched on the trimmed lowercase value, because free
--    text carries whatever somebody typed, and written as the company spells it.
update vessl.quotes
   set factory = 'Liaoning Kangping Plastic Industry Co., Ltd',
       updated_at = now()
 where lower(btrim(factory)) = 'liaoning kangping plastic industry co.,ltd';

update vessl.quotes
   set factory = 'Aung Crown',
       updated_at = now()
 where lower(btrim(factory)) = 'aung crown'
   and btrim(factory) <> 'Aung Crown';

update vessl.quotes
   set factory = 'Shenzhen Baoquan Industrial Co., Ltd',
       updated_at = now()
 where lower(btrim(factory)) = 'baoquan';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the three aliases held forty four, seven and one' as chk,
         (select alias_liaoning::text || '/' || alias_aung::text || '/' || alias_baoquan::text from _pre71) as got,
         '44/7/1' as want
  union all
  select 'a1 the targets held none, none and two',
         (select target_liaoning::text || '/' || target_baoquan::text from _pre71), '0/2'
  union all
  select 'a2 all three target companies existed as factories',
         (select targets_exist::text from _pre71), '3'
  union all
  select 'a3 the archive captured all fifty two rows',
         (select jsonb_array_length(touched)::text from _arch71), '52'
  union all
  select 'b1 no quote holds any of the three aliases now',
         ((select count(*) from vessl.quotes
            where lower(btrim(factory)) = 'liaoning kangping plastic industry co.,ltd')
        + (select count(*) from vessl.quotes
            where lower(btrim(factory)) = 'aung crown' and btrim(factory) <> 'Aung Crown')
        + (select count(*) from vessl.quotes where lower(btrim(factory)) = 'baoquan'))::text, '0'
  union all
  select 'b2 the targets now hold forty four, seven and three',
         (select count(*)::text from vessl.quotes
           where btrim(factory) = 'Liaoning Kangping Plastic Industry Co., Ltd') || '/' ||
         (select count(*)::text from vessl.quotes where btrim(factory) = 'Aung Crown') || '/' ||
         (select count(*)::text from vessl.quotes
           where btrim(factory) = 'Shenzhen Baoquan Industrial Co., Ltd'), '44/7/3'
  union all
  select 'b3 every factory text now matches a company',
         (select count(*)::text from vessl.quotes q
           where coalesce(btrim(q.factory),'') <> ''
             and not exists (select 1 from vessl.companies c
                              where lower(btrim(c.name)) = lower(btrim(q.factory)))), '0'
  union all
  -- TWO RENAMES AND ONE MERGE, which is why this lands on eight rather than six.
  -- Only Baoquan had a target that already carried quotes, so only Baoquan
  -- collapses into an existing value. The Liaoning and Aung Crown targets held
  -- none, so those two are new distinct values rather than disappearing ones.
  select 'b4 nine distinct spellings became eight, two renamed and one merged',
         (select distinct_before::text from _pre71) || '/' ||
         (select count(distinct lower(btrim(factory)))::text from vessl.quotes
           where coalesce(btrim(factory),'') <> ''), '9/8'
  union all
  select 'c1 no quote was added, removed, or left without a factory',
         (select ((select count(*) from vessl.quotes) - quotes_before)::text || '/' ||
                 ((select count(*) from vessl.quotes where coalesce(btrim(factory),'') <> '')
                   - with_factory_before)::text
            from _pre71), '0/0'
  union all
  select 'c2 no company row was touched',
         (select count(*)::text from vessl.companies where type::text = 'factory'), '8'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
