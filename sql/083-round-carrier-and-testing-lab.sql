-- 83 -- A carrier on each sample round, and a testing lab on each card.
--
-- WHAT IT DOES. Adds two nullable text columns and nothing else.
--   vessl.program_sample_rounds.carrier -- who carried the sample in that round,
--     FedEx, UPS, DHL or anything else, as typed. It sits beside tracking_number
--     from script 82.
--   vessl.programs.testing_lab -- the lab testing the product for this card, as
--     typed. Set on the first tab while the card is in Testing, and reported on
--     the Card tab.
-- No backfill. Neither value has been recorded anywhere before.
--
-- NO GRANT WORK. authenticated holds table level arwd on both tables and no
-- table carries a column grant, so a column added now is covered by the table
-- grant for select, insert and update exactly as the others are. b5 asserts
-- that per column, and c1 asserts both ACLs are byte for byte unchanged.
--
-- POLICIES AND TRIGGERS UNTOUCHED. Each table has the one staff_only policy on
-- vessl.is_staff, and neither names a column. The one trigger on programs,
-- trg_programs_declared_stage_at, reads declared_stage only.
--
-- MEASURED BEFORE WRITING, against the live database
--   programs has 15 columns and 1 card. program_sample_rounds has 13 columns
--   and 0 rows -- the three ZZTESTPLM rounds were deleted through the app this
--   afternoon and are to be re-entered by hand. Neither new column exists. Both
--   ACLs are postgres arwdDxtm and authenticated arwd. No column carries an ACL.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre83 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl'
             and ((table_name = 'programs' and column_name = 'testing_lab')
               or (table_name = 'program_sample_rounds' and column_name = 'carrier')))  as new_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs')                    as p_cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds')       as r_cols_before,
         (select count(*) from vessl.programs)                                          as cards_before,
         (select count(*) from vessl.program_sample_rounds)                             as rounds_before,
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass)     as p_acl_before,
         (select relacl::text from pg_class
           where oid = 'vessl.program_sample_rounds'::regclass)                         as r_acl_before,
         (select string_agg(c.relname || ' ' || pol.polname || ' ' || pol.polcmd::text || ' '
                            || pg_get_expr(pol.polqual, pol.polrelid), ' / ' order by c.relname, pol.polname)
            from pg_policy pol join pg_class c on c.oid = pol.polrelid
           where pol.polrelid in ('vessl.programs'::regclass,
                                  'vessl.program_sample_rounds'::regclass))              as pols_before,
         (select string_agg(tgname, ' ' order by tgname) from pg_trigger
           where tgrelid in ('vessl.programs'::regclass, 'vessl.program_sample_rounds'::regclass)
             and not tgisinternal)                                                      as trigs_before;

do $guard$
begin
  if (select new_before from _pre83) <> 0 then
    raise exception 'carrier or testing_lab already exists, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds
  add column carrier text;

comment on column vessl.program_sample_rounds.carrier is
  'Who carried the sample in this round -- FedEx, UPS, DHL or other, as typed. Null when none was recorded.';

alter table vessl.programs
  add column testing_lab text;

comment on column vessl.programs.testing_lab is
  'The lab testing the product for this card, as typed. Set on the card while it is in Testing. Null when none was recorded.';

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 neither column existed before' as chk,
         (select new_before::text from _pre83) as got, '0' as want
  union all
  select 'b1 carrier exists now, text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name = 'carrier'), 'text/YES/none'
  union all
  select 'b2 testing_lab exists now, text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'testing_lab'), 'text/YES/none'
  union all
  select 'b3 each table gained exactly one column',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'programs') - p_cols_before)::text || '/' ||
                 ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'program_sample_rounds') - r_cols_before)::text
            from _pre83), '1/1'
  union all
  select 'b4 no row added or removed, and neither new column holds anything',
         (select ((select count(*) from vessl.programs) - cards_before)::text || '/' ||
                 ((select count(*) from vessl.program_sample_rounds) - rounds_before)::text || '/' ||
                 (select count(testing_lab) from vessl.programs)::text || '/' ||
                 (select count(carrier) from vessl.program_sample_rounds)::text
            from _pre83), '0/0/0/0'
  union all
  -- THE REASON THERE IS NO GRANT BLOCK. authenticated reaches both new columns
  -- for select, insert and update through its table grant, and anon reaches
  -- neither.
  select 'b5 authenticated may select insert update both, anon neither',
         (select has_column_privilege('authenticated', 'vessl.program_sample_rounds', 'carrier', 'SELECT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.program_sample_rounds', 'carrier', 'INSERT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.program_sample_rounds', 'carrier', 'UPDATE')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'testing_lab', 'SELECT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'testing_lab', 'INSERT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'testing_lab', 'UPDATE')::text || '/' ||
                 has_column_privilege('anon', 'vessl.program_sample_rounds', 'carrier', 'SELECT')::text || '/' ||
                 has_column_privilege('anon', 'vessl.programs', 'testing_lab', 'SELECT')::text),
         'true/true/true/true/true/true/false/false'
  union all
  select 'c1 both table ACLs are unchanged',
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) || ' | ' ||
         (select relacl::text from pg_class where oid = 'vessl.program_sample_rounds'::regclass),
         (select p_acl_before || ' | ' || r_acl_before from _pre83)
  union all
  select 'c1b and they are the owner plus authenticated arwd',
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) || ' | ' ||
         (select relacl::text from pg_class where oid = 'vessl.program_sample_rounds'::regclass),
         '{postgres=arwdDxtm/postgres,authenticated=arwd/postgres} | {postgres=arwdDxtm/postgres,authenticated=arwd/postgres}'
  union all
  select 'c2 no column on either table carries its own grant',
         (select count(*)::text from pg_attribute
           where attrelid in ('vessl.programs'::regclass, 'vessl.program_sample_rounds'::regclass)
             and attacl is not null), '0'
  union all
  select 'c3 the policies on both tables are unchanged',
         (select string_agg(c.relname || ' ' || pol.polname || ' ' || pol.polcmd::text || ' '
                            || pg_get_expr(pol.polqual, pol.polrelid), ' / ' order by c.relname, pol.polname)
            from pg_policy pol join pg_class c on c.oid = pol.polrelid
           where pol.polrelid in ('vessl.programs'::regclass, 'vessl.program_sample_rounds'::regclass)),
         (select pols_before from _pre83)
  union all
  select 'c4 the triggers on both tables are unchanged',
         (select coalesce(string_agg(tgname, ' ' order by tgname), '') from pg_trigger
           where tgrelid in ('vessl.programs'::regclass, 'vessl.program_sample_rounds'::regclass)
             and not tgisinternal),
         (select coalesce(trigs_before, '') from _pre83)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
