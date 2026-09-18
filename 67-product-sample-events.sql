-- 67 -- a sample is an event with a date, not a column on the product.
--
-- WHAT IT DOES. Adds sample_date and sample_stage to vessl.product_notes, widens
-- the kind CHECK to admit a second kind, adds a CHECK that a sample event says
-- something, extends the column UPDATE grant to the two new columns, and drops
-- vessl.products.sample_date.
--
-- WHY THE COLUMN GOES. Script 66 put sample_date on the product, and that was
-- wrong in a way that only showed once somebody tried to use it. A product is
-- sampled more than once -- that is the whole reason the board had Sample 1
-- through Sample 5 before script 65 collapsed them -- and one date column can
-- hold exactly one of those rounds. Recording the second sample meant overwriting
-- the first, so the column could only ever describe the most recent round while
-- looking like it described the sampling.
--
-- A ROW PER ROUND INSTEAD. product_notes already carries an author, a timestamp,
-- an edit stamp and the author-only policies, which is most of what a sample
-- event needs. Adding two columns to it costs one table rather than two, and the
-- log and the free-text notes then share one set of rules that cannot drift
-- apart.
--
-- kind IS WHAT SEPARATES THEM. A sample event carries kind = sample_event and at
-- least one of the two new columns. A free-text note carries kind = sampling and
-- neither. The CHECK enforces the first half of that, which is the half that
-- would otherwise produce a log entry saying nothing.
--
-- THE REVOKE-FIRST LESSON DOES NOT APPLY HERE. Script 66 had to revoke before it
-- granted because CREATE TABLE in this schema hands authenticated arwdDxtm by
-- default. product_notes already exists and already went through that, so the
-- default privileges never fire again for it. The grant below is purely additive
-- and b8 through b10 re-measure the result rather than assuming it.
--
-- THE APP MUST SHIP WITH THIS. programs.jsx selects products.sample_date today,
-- and PostgREST fails the whole request when a selected column is missing -- so
-- the board stops loading the moment this runs against the old code. Run it with
-- the matching app change, not before it.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.product_notes -- 7 columns, 0 rows, one CHECK named
--     product_notes_kind_check reading kind = sampling.
--   authenticated holds select, insert and delete at table level, no table
--     update, and column update on note and edited_at only.
--   Three policies, staff_only permissive for all, plus the two restrictive
--     author-only ones for update and delete.
--   vessl.products -- 35 columns, and sample_date is non null on ZERO rows.
--     The ZZTESTPLM value that prompted the tolerance below is already gone.

begin;

-- PRE-STATE FIRST, counted before anything is written.
create temp table _pre67 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'product_notes')            as note_cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products')                 as product_cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'
             and column_name = 'sample_date')                                        as had_product_col,
         (select count(*) from vessl.products where sample_date is not null)         as products_dated,
         (select count(*) from vessl.product_notes)                                  as notes_before,
         (select count(*) from vessl.products)                                       as products_before,
         (select count(*) from pg_constraint
           where conrelid = 'vessl.product_notes'::regclass and contype = 'c')       as checks_before,
         (select count(*) from pg_policies where schemaname = 'vessl'
           and tablename = 'product_notes')                                          as policies_before;

-- REFUSE rather than build on a schema that is not the one measured.
do $guard$
begin
  if (select had_product_col from _pre67) <> 1 then
    raise exception 'products does not carry sample_date, so there is nothing to drop, nothing changed';
  end if;
  -- ONE ROW OF TOLERANCE, AND NOT ONE MORE. The measurement says zero products
  -- carry a date. One would be the ZZTESTPLM row and is throwaway. Two would mean
  -- somebody started using the column for real, and dropping it would destroy a
  -- record this script has no instruction to move.
  if (select products_dated from _pre67) > 1 then
    raise exception 'more than one product carries a sample date, so the drop would lose a record, nothing changed';
  end if;
  if (select note_cols_before from _pre67) <> 7 then
    raise exception 'product_notes is not the seven column table measured, nothing changed';
  end if;
  if (select checks_before from _pre67) <> 1 then
    raise exception 'product_notes does not carry exactly the one CHECK measured, nothing changed';
  end if;
end
$guard$;

-- 1. WHAT A SAMPLE EVENT RECORDS. A date, because the question people ask is when
--    the sample happened, and a round number, because the question after that is
--    which round it was. Both are nullable and the CHECK further down requires at
--    least one of them, so an entry can be a dated round, a dated sample nobody
--    numbered, or a numbered round nobody has a date for.
alter table vessl.product_notes add column sample_date date;
alter table vessl.product_notes add column sample_stage text;

-- The five rungs the board carried before script 65 folded them into one stage.
-- They live here rather than on the board because a log entry is a historical
-- fact about a product and the stage is a decision about a card.
alter table vessl.product_notes
  add constraint product_notes_sample_stage_check
  check (sample_stage is null
         or sample_stage in ('sample_1', 'sample_2', 'sample_3', 'sample_4', 'sample_5'));

-- 2. TWO KINDS NOW. The CHECK is replaced rather than widened in place, because
--    Postgres has no alter constraint for a check body -- drop and add is the
--    only form, and doing it inside this transaction means no window exists where
--    the table is unconstrained.
alter table vessl.product_notes drop constraint product_notes_kind_check;
alter table vessl.product_notes
  add constraint product_notes_kind_check
  check (kind in ('sampling', 'sample_event'));

-- 3. A SAMPLE EVENT HAS TO SAY SOMETHING. Without this an entry could carry the
--    kind and nothing else, and the log would render a row that reports a sample
--    with no round and no date -- which is not a record of anything.
alter table vessl.product_notes
  add constraint product_notes_sample_event_check
  check (kind <> 'sample_event'
         or sample_date is not null
         or sample_stage is not null);

-- 4. THE COLUMN GRANT, EXTENDED. Editing an entry means changing its round, its
--    date or its comment, so the three writable columns are note, sample_date and
--    sample_stage, plus the edited_at stamp the panel writes with them. author and
--    kind stay unwritable, which is what stops an entry being reassigned to
--    somebody else or quietly turned into a free-text note.
grant update (note, edited_at, sample_date, sample_stage) on vessl.product_notes to authenticated;

-- 5. AND THE COLUMN THAT CANNOT HOLD THE ANSWER GOES. Measured at zero rows
--    carrying a value, and the guard above refuses if that ever became more than
--    one.
alter table vessl.products drop column sample_date;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 product_notes had seven columns and products thirty five' as chk,
         (select note_cols_before::text || '/' || product_cols_before::text from _pre67) as got, '7/35' as want
  union all
  select 'a1 no product carried a sample date, as measured',
         (select products_dated::text from _pre67), '0'
  union all
  select 'a2 product_notes carried exactly one check',
         (select checks_before::text from _pre67), '1'
  union all
  select 'b1 sample_date exists as a nullable date',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'product_notes'
             and column_name = 'sample_date' and data_type = 'date' and is_nullable = 'YES'), '1'
  union all
  select 'b2 sample_stage exists as nullable text',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'product_notes'
             and column_name = 'sample_stage' and data_type = 'text' and is_nullable = 'YES'), '1'
  union all
  select 'b3 product_notes has its nine columns',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'product_notes'), '9'
  union all
  select 'b4 kind permits both values and nothing else',
         (select (case when pg_get_constraintdef(oid) like '%sampling%'
                        and pg_get_constraintdef(oid) like '%sample_event%' then 'both' else 'no' end)::text
            from pg_constraint where conrelid = 'vessl.product_notes'::regclass
             and conname = 'product_notes_kind_check'), 'both'
  union all
  select 'b5 the five rungs are the only stages permitted',
         (select (case when pg_get_constraintdef(oid) like '%sample_1%'
                        and pg_get_constraintdef(oid) like '%sample_5%' then 'five' else 'no' end)::text
            from pg_constraint where conrelid = 'vessl.product_notes'::regclass
             and conname = 'product_notes_sample_stage_check'), 'five'
  union all
  select 'b6 a sample event must carry a date or a stage',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.product_notes'::regclass
             and conname = 'product_notes_sample_event_check'), '1'
  union all
  select 'b7 three checks on the table now',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.product_notes'::regclass and contype = 'c'), '3'
  union all
  -- THE GRANT IS RE-MEASURED RATHER THAN ASSUMED. The lesson from 66 was that a
  -- grant statement is not evidence of the grant that ended up on the table.
  select 'b8 column update reaches exactly the four writable columns',
         (select string_agg(a.attname, ',' order by a.attname)
            from pg_attribute a
           where a.attrelid = 'vessl.product_notes'::regclass
             and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')),
         'edited_at,note,sample_date,sample_stage'
  union all
  select 'b9 author and kind stay unwritable',
         (has_column_privilege('authenticated', 'vessl.product_notes', 'author', 'UPDATE')::text || '/'
       || has_column_privilege('authenticated', 'vessl.product_notes', 'kind', 'UPDATE')::text), 'false/false'
  union all
  select 'b10 table level update is still not granted',
         has_table_privilege('authenticated', 'vessl.product_notes', 'UPDATE')::text, 'false'
  union all
  select 'b11 select insert and delete are untouched',
         (has_table_privilege('authenticated', 'vessl.product_notes', 'SELECT')::text || '/'
       || has_table_privilege('authenticated', 'vessl.product_notes', 'INSERT')::text || '/'
       || has_table_privilege('authenticated', 'vessl.product_notes', 'DELETE')::text), 'true/true/true'
  union all
  select 'b12 anon still holds nothing on the table',
         (has_table_privilege('anon', 'vessl.product_notes', 'SELECT')::text || '/'
       || has_table_privilege('anon', 'vessl.product_notes', 'UPDATE')::text), 'false/false'
  union all
  select 'b13 the three policies are untouched',
         (select (count(*)::text || '/' || (select policies_before from _pre67)::text)
            from pg_policies where schemaname = 'vessl' and tablename = 'product_notes'), '3/3'
  union all
  select 'b14 products no longer carries sample_date',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'
             and column_name = 'sample_date'), '0'
  union all
  select 'b15 products is back to thirty four columns',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'products'), '34'
  union all
  select 'c1 no row was added or removed anywhere',
         (select ((select count(*) from vessl.product_notes) - (select notes_before from _pre67))::text || '/'
              || ((select count(*) from vessl.products)      - (select products_before from _pre67))::text
            from _pre67 limit 1), '0/0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
