-- 77 -- the sample strip, stored on the card.
--
-- WHAT IT DOES. Adds four nullable columns to vessl.programs -- sample_round,
-- master_sample_included, sample_sent_date and sample_due_back. No row is
-- written, no grant is changed, and nothing else on the table is touched.
--
-- ON THE PROGRAM, NOT THE PRODUCT, and that is the whole decision. The sampling
-- LOG lives in product_notes and is shared by every card for a SKU, because a
-- round that happened happened once whoever it was for. These four are the
-- opposite -- they describe the round in flight for ONE client, and two clients
-- sampling the same product are on different rounds with different dates. Put
-- here they can disagree, which is correct. Put on the product they would
-- overwrite each other, which is the fault script 67 already fixed once.
--
-- NULLABLE AND WITHOUT DEFAULTS, all four. A card that has never been sampled
-- should say nothing rather than claim round 1 on the day it is created, and the
-- board draws the strip only for cards in sampling or revision. The card renders
-- a null round as 1 for the person editing it, which is a display choice and not
-- a stored one.
--
-- master_sample_included IS THREE STATE on purpose. NULL means nobody has said,
-- true and false are both answers, and the card offers Yes and No as buttons
-- rather than a checkbox for exactly that reason -- an unticked box cannot tell
-- the difference between no and not asked.
--
-- NO GRANT WORK, and this is worth stating because the instinct is to add some.
-- authenticated holds table level UPDATE on vessl.programs, measured as arw, and
-- a table level privilege covers columns added afterwards. A column grant here
-- would narrow nothing and would imply the other columns were restricted. b4
-- asserts the privilege reaches the new columns rather than assuming it.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.programs -- 3 rows, 14 columns, none of the four below among them.
--   authenticated holds arw on the table -- INSERT, SELECT and UPDATE, no DELETE.
--   the sampling log in product_notes is unaffected and stays the history.

begin;

-- PRE-STATE FIRST, before the columns exist.
create temp table _pre77 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round','master_sample_included',
                                 'sample_sent_date','sample_due_back'))          as new_cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs')             as all_cols_before,
         (select count(*) from vessl.programs)                                   as rows_before,
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) as acl_before;

do $guard$
begin
  if (select new_cols_before from _pre77) <> 0 then
    raise exception 'one of the four sample columns already exists on vessl.programs, nothing changed';
  end if;
  -- The board reads these through the same table grant everything else uses. If
  -- UPDATE were missing the columns would be unwritable and the card would fail
  -- silently on every save.
  if not has_table_privilege('authenticated', 'vessl.programs', 'UPDATE') then
    raise exception 'authenticated cannot update vessl.programs, so these columns would be unwritable, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs
  add column sample_round           integer,
  add column master_sample_included boolean,
  add column sample_sent_date       date,
  add column sample_due_back        date;

comment on column vessl.programs.sample_round is
  'Which sample round this card is on, for this client. Null until somebody says. The card shows 1 for a null, which is a display choice rather than a stored one.';
comment on column vessl.programs.master_sample_included is
  'Three state. True and false are both answers and null means nobody has said, which is why the card offers Yes and No rather than a checkbox.';
comment on column vessl.programs.sample_sent_date is
  'When the sample for the round in flight went out, for this client. The per round history lives in product_notes and is shared across every card for the SKU.';
comment on column vessl.programs.sample_due_back is
  'When it is expected back. A date in the past turns the field red on the card and counts the program as stalled on the board.';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 none of the four columns existed before' as chk,
         (select new_cols_before::text from _pre77) as got, '0' as want
  union all
  select 'b1 all four exist now',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round','master_sample_included',
                                 'sample_sent_date','sample_due_back')), '4'
  union all
  select 'b2 the types are the ones the card writes',
         (select string_agg(column_name || '=' || data_type, ' ' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round','master_sample_included',
                                 'sample_sent_date','sample_due_back')),
         'master_sample_included=boolean sample_due_back=date sample_round=integer sample_sent_date=date'
  union all
  -- NULLABLE AND UNDEFAULTED, both asserted. A default would make every existing
  -- card claim a sample round it never had.
  select 'b3 all four are nullable and carry no default',
         (select string_agg(is_nullable || coalesce(column_default, 'none'), ' ' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round','master_sample_included',
                                 'sample_sent_date','sample_due_back')),
         'YESnone YESnone YESnone YESnone'
  union all
  -- THE REASON THERE IS NO GRANT BLOCK. Asserted rather than assumed.
  select 'b4 the table update privilege reaches the new columns',
         (select has_column_privilege('authenticated', 'vessl.programs', 'sample_round', 'UPDATE')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'master_sample_included', 'UPDATE')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'sample_sent_date', 'UPDATE')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'sample_due_back', 'UPDATE')::text),
         'true/true/true/true'
  union all
  select 'b5 the table grant itself is unchanged',
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass),
         (select acl_before::text from _pre77)
  union all
  select 'b6 every existing card has all four null',
         (select count(*)::text from vessl.programs
           where sample_round is null and master_sample_included is null
             and sample_sent_date is null and sample_due_back is null),
         (select rows_before::text from _pre77)
  union all
  select 'c1 four columns were added and nothing was dropped',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'programs') - all_cols_before)::text
            from _pre77), '4'
  union all
  select 'c2 no program row was added or removed',
         (select ((select count(*) from vessl.programs) - rows_before)::text from _pre77), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
