-- 102r -- Reverse 102. Sample types go back to the five fixed keys and the CHECK.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 102. One transaction.
--
-- WHAT IT DOES. Drops the foreign key from program_sample_rounds.sample_type,
-- puts back program_sample_rounds_sample_type_check exactly as script 97 had it,
-- and drops vessl.sample_types with its index and policies. No round is written.
--
-- TYPES ADDED FROM THE APP ARE LOST with the table -- r1 says how many. That is
-- only allowed while no round holds one -- a round on an added type could not
-- satisfy the five-key CHECK, so the guard stops and says how many rounds to
-- clear first rather than rewrite anybody work. Take + Add new sample type out
-- of the app before running this.
--
-- GUARDS. The table and the foreign key exist; no round holds a key outside the
-- five.
--
-- AFTER. b1 is the strong check -- the CHECK hashes to the script 97 value
-- measured on 1 Oct. b3 proves no round changed.
--
-- WHAT A PASS LOOKS LIKE. r1 plus z0. Any a or b row is a failed check.

begin;

create temp table _pre102r on commit drop as
  select
    (to_regclass('vessl.sample_types') is not null)::text                                        as has_table,
    (select count(*) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_sample_type_fkey')                                  as has_fkey,
    (select count(*) from vessl.program_sample_rounds
      where sample_type is not null
        and sample_type not in ('first', 'pre_production', 'production', 'testing_production', 'testing')) as n_added_in_use,
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rounds;

do $guard$
begin
  if (select has_table from _pre102r) <> 'true' or (select has_fkey from _pre102r) <> 1 then
    raise exception 'sample_types or its foreign key is missing, so 102 is not in place, nothing changed';
  end if;
  if (select n_added_in_use from _pre102r) <> 0 then
    raise exception '% round(s) hold a sample type added from the app -- clear them first, nothing changed',
      (select n_added_in_use from _pre102r);
  end if;
end
$guard$;

-- Counted from the table before it goes, read dynamically so this file parses
-- whether or not the table exists.
create temp table _added102r (n bigint) on commit drop;
do $count$
begin
  execute 'insert into _added102r select count(*) from vessl.sample_types where key not in '
       || '(''first'', ''pre_production'', ''production'', ''testing_production'', ''testing'')';
end
$count$;

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_sample_type_fkey;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_sample_type_check
  check (sample_type is null or sample_type = any (array['first', 'pre_production', 'production',
                                                         'testing_production', 'testing']));
comment on column vessl.program_sample_rounds.sample_type is
  'What was sent in this round -- first, pre_production, production, testing_production or testing (script 97). Replaces master_sample, which is no longer read. NULL is Not set.';

drop table vessl.sample_types;

-- VERIFICATION. r1 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r1 types that had been added from the app, now gone' as chk,
         (select n::text from _added102r) as got,
         'shown every run' as want
  union all
  select 'a0 table and foreign key existed, no round on an added type',
         (select has_table || '/' || has_fkey::text || '/' || n_added_in_use::text from _pre102r),
         'true/1/0'
  union all
  select 'b1 the CHECK hashes to the script 97 value and is validated; the foreign key is gone',
         (select (md5(pg_get_constraintdef(oid)) = '5b68497f21c009e671afbf682991d904')::text || '/' || convalidated::text
            from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_sample_type_check')
         || '/' || (select count(*) from pg_constraint
                     where conrelid = 'vessl.program_sample_rounds'::regclass
                       and conname = 'program_sample_rounds_sample_type_fkey')::text,
         'true/true/0'
  union all
  select 'b2 the table is gone',
         (to_regclass('vessl.sample_types') is null)::text, 'true'
  union all
  select 'b3 every round unchanged',
         (select ((select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                     from vessl.program_sample_rounds r) = h_rounds)::text from _pre102r),
         'true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
