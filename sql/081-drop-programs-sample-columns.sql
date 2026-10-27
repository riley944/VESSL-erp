-- 81 -- Drop the four superseded sample columns from vessl.programs.
--
-- WHAT IT DOES. Drops sample_round, master_sample_included, sample_sent_date
-- and sample_due_back from vessl.programs. Script 77 added them for the live
-- sample strip on the PLM card. Script 80 replaced that strip with saved rounds
-- in vessl.program_sample_rounds, and the code shipped in c34d983 stopped
-- reading and writing these four. Nothing else is changed.
--
-- NO CASCADE. Each drop is a plain drop column, so if anything did depend on a
-- column -- a view, an index, a constraint -- Postgres refuses and nothing is
-- dropped, rather than taking the dependent object with it.
--
-- WHAT IS LOST. One card holds values, ZZTESTPLM, whose strip reads round 1,
-- master sample true, sent 2026-01-01, due back 2026-10-01. Script 80 copied
-- exactly those into its round 1 row in program_sample_rounds, which is where the
-- card reads them now, so nothing the app shows goes away. The guard refuses to
-- run unless that round 1 row is there.
--
-- GRANTS. authenticated holds table level arwd on programs and no column
-- grants, so dropping columns changes no grant. c1 asserts the table ACL is
-- byte for byte what it was.
--
-- MEASURED BEFORE WRITING, against the live database
--   app and lib hold no reference to the four columns. No view, materialized
--   view, function, policy, index, constraint, rule, trigger or publication
--   names them, and pg_depend holds no row on them. The one trigger on programs,
--   trg_programs_declared_stage_at, reads declared_stage only.
--   programs has 19 columns and 1 card. program_sample_rounds has 3 rows, and
--   ZZTESTPLM round 1 is among them.
--   programs ACL is postgres arwdDxtm and authenticated arwd. Rounds ACL is
--   postgres arwdDxtm and authenticated arw.

begin;

-- PRE-STATE FIRST, before any DDL.
create temp table _pre81 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round', 'master_sample_included',
                                 'sample_sent_date', 'sample_due_back'))            as four_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs')               as cols_before,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'vessl' and c.relname = 'program_sample_rounds'
             and c.relkind = 'r')                                                   as rounds_tbl,
         (select count(*) from vessl.program_sample_rounds r
           where r.program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
             and length(r.program_id::text) = 36
             and r.round = 1 and r.stage = 'sampling')                              as zz_round1,
         (select count(*) from vessl.programs)                                      as cards_before,
         (select count(*) from vessl.program_sample_rounds)                         as rounds_before,
         (select md5(coalesce(string_agg(r::text, '|' order by r.id), ''))
            from vessl.program_sample_rounds r)                                     as rounds_hash_before,
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) as acl_before,
         (select relacl::text from pg_class
           where oid = 'vessl.program_sample_rounds'::regclass)                     as rounds_acl_before,
         (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' / ' order by conname)
            from pg_constraint where conrelid = 'vessl.programs'::regclass)         as cons_before,
         (select string_agg(polname, ' ' order by polname)
            from pg_policy where polrelid = 'vessl.programs'::regclass)             as pols_before,
         (select string_agg(tgname, ' ' order by tgname)
            from pg_trigger where tgrelid = 'vessl.programs'::regclass
             and not tgisinternal)                                                  as trigs_before;

-- Every column that is NOT being dropped, as it stands now, so b3 can prove
-- none of them moved.
create temp table _keep81 on commit drop as
  select a.attnum, a.attname::text as attname, format_type(a.atttypid, a.atttypmod) as typ,
         a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as dflt
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'vessl.programs'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('sample_round', 'master_sample_included',
                           'sample_sent_date', 'sample_due_back');

do $guard$
begin
  if (select four_before from _pre81) <> 4 then
    raise exception 'vessl.programs does not have all four sample columns, nothing changed';
  end if;
  if (select rounds_tbl from _pre81) <> 1 then
    raise exception 'vessl.program_sample_rounds does not exist, nothing changed';
  end if;
  if (select zz_round1 from _pre81) <> 1 then
    raise exception 'ZZTESTPLM has no round 1 in program_sample_rounds, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs
  drop column sample_round,
  drop column master_sample_included,
  drop column sample_sent_date,
  drop column sample_due_back;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 all four columns existed before' as chk,
         (select four_before::text from _pre81) as got, '4' as want
  union all
  select 'a1 program_sample_rounds existed with ZZTESTPLM round 1',
         (select rounds_tbl::text || '/' || zz_round1::text from _pre81), '1/1'
  union all
  select 'b1 none of the four columns is left',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name in ('sample_round', 'master_sample_included',
                                 'sample_sent_date', 'sample_due_back')), '0'
  union all
  select 'b2 the column count went down by exactly four',
         (select (cols_before - (select count(*) from information_schema.columns
                                  where table_schema = 'vessl' and table_name = 'programs'))::text
            from _pre81), '4'
  union all
  -- NO OTHER COLUMN TOUCHED. Position, name, type, not null and default of every
  -- kept column, compared both ways against the snapshot.
  select 'b3 every other column is exactly as it was',
         (select count(*)::text from (
            (select * from _keep81
             except
             select a.attnum, a.attname::text, format_type(a.atttypid, a.atttypmod),
                    a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
               from pg_attribute a
               left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where a.attrelid = 'vessl.programs'::regclass and a.attnum > 0 and not a.attisdropped)
            union all
            (select a.attnum, a.attname::text, format_type(a.atttypid, a.atttypmod),
                    a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
               from pg_attribute a
               left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where a.attrelid = 'vessl.programs'::regclass and a.attnum > 0 and not a.attisdropped
             except
             select * from _keep81)
          ) diff), '0'
  union all
  select 'b4 the card count is unchanged',
         (select ((select count(*) from vessl.programs) - cards_before)::text from _pre81), '0'
  union all
  select 'b5 program_sample_rounds is untouched, row count and every value',
         (select count(*)::text || '/' || md5(coalesce(string_agg(r::text, '|' order by r.id), ''))
            from vessl.program_sample_rounds r),
         (select rounds_before::text || '/' || rounds_hash_before from _pre81)
  union all
  select 'c1 the grant on programs is unchanged',
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass),
         (select acl_before from _pre81)
  union all
  select 'c2 the grant on program_sample_rounds is unchanged',
         (select relacl::text from pg_class where oid = 'vessl.program_sample_rounds'::regclass),
         (select rounds_acl_before from _pre81)
  union all
  select 'c3 the constraints on programs are unchanged',
         (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' / ' order by conname)
            from pg_constraint where conrelid = 'vessl.programs'::regclass),
         (select cons_before from _pre81)
  union all
  select 'c4 the policies and triggers on programs are unchanged',
         (select coalesce((select string_agg(polname, ' ' order by polname)
                             from pg_policy where polrelid = 'vessl.programs'::regclass), '')
                 || ' | ' ||
                 coalesce((select string_agg(tgname, ' ' order by tgname)
                             from pg_trigger where tgrelid = 'vessl.programs'::regclass
                              and not tgisinternal), '')),
         (select coalesce(pols_before, '') || ' | ' || coalesce(trigs_before, '') from _pre81)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
