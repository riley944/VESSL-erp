-- 82 -- Sample rounds get a tracking number, and can be deleted.
--
-- WHAT IT DOES. Two things to vessl.program_sample_rounds, and nothing else.
--   1. Adds tracking_number, nullable text with no default -- the courier
--      tracking number for the sample sent in that round, FedEx, UPS or anything
--      else, as typed. No backfill, since no round has one yet.
--   2. Grants DELETE to authenticated, so any staff can delete a round from its
--      Edit form, the way any staff can edit one.
--
-- WHY ONLY A GRANT FOR DELETE. The one policy, staff_only, is permissive FOR ALL
-- on vessl.is_staff, so it already covers DELETE. What stopped a delete was that
-- script 80 granted select, insert and update and withheld delete on purpose.
-- That decision is reversed here, and the policy is left exactly as it is. c2
-- and c3 assert that.
--
-- DELETING DOES NOT RENUMBER. The unique (program_id, round) constraint and the
-- round and stage CHECK are untouched. Deleting round 3 of 4 leaves 1, 2 and 4,
-- and the next round the card offers is still one past the highest.
--
-- NO TRUNCATE, AND NOTHING FOR anon. The grant is DELETE alone, so the end state
-- is authenticated arwd, and c1 asserts the whole ACL rather than the one bit.
--
-- MEASURED BEFORE WRITING, against the live database
--   program_sample_rounds has 12 columns and 3 rows, rounds 1, 2 and 3 on
--   ZZTESTPLM. ACL is postgres arwdDxtm and authenticated arw. RLS is on and not
--   forced. One policy, staff_only, permissive, all commands, is_staff for both
--   using and with check. Four constraints -- the primary key, the foreign key to
--   programs, one_per_round and round_stage_check. No trigger.

begin;

-- PRE-STATE FIRST, before any DDL. The row hash names the twelve existing
-- columns rather than taking the whole row, because the whole row gains a
-- column below and would hash differently for that reason alone.
create temp table _pre82 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name = 'tracking_number')                                   as col_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds')    as cols_before,
         (select count(*) from vessl.program_sample_rounds)                          as rows_before,
         (select md5(coalesce(string_agg(concat_ws('|', id, program_id, stage, round, master_sample,
                                                   sent_date, due_back, comment, created_by, created_at,
                                                   updated_by, updated_at), '/' order by id), ''))
            from vessl.program_sample_rounds)                                        as hash_before,
         (select relacl::text from pg_class
           where oid = 'vessl.program_sample_rounds'::regclass)                      as acl_before,
         (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' / ' order by conname)
            from pg_constraint where conrelid = 'vessl.program_sample_rounds'::regclass) as cons_before;

do $guard$
begin
  if (select col_before from _pre82) <> 0 then
    raise exception 'program_sample_rounds already has tracking_number, nothing changed';
  end if;
  if has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'DELETE') then
    raise exception 'authenticated can already delete from program_sample_rounds, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds
  add column tracking_number text;

comment on column vessl.program_sample_rounds.tracking_number is
  'Courier tracking number for the sample sent in this round -- FedEx, UPS or other, as typed. Null when none was recorded.';

grant delete on vessl.program_sample_rounds to authenticated;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 tracking_number did not exist before' as chk,
         (select col_before::text from _pre82) as got, '0' as want
  union all
  select 'a1 the table held twelve columns before',
         (select cols_before::text from _pre82), '12'
  union all
  select 'b1 tracking_number exists now as text',
         (select string_agg(data_type, ' ') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name = 'tracking_number'), 'text'
  union all
  select 'b2 it is nullable with no default',
         (select is_nullable || coalesce(column_default, 'none') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name = 'tracking_number'), 'YESnone'
  union all
  select 'b3 one column was added and nothing else',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'program_sample_rounds') - cols_before)::text
            from _pre82), '1'
  union all
  -- NO ROW MOVED. The same twelve columns, hashed the same way as before, and no
  -- round gained a tracking number.
  select 'b4 every existing round is unchanged and carries no tracking number',
         (select count(*)::text || '/' ||
                 md5(coalesce(string_agg(concat_ws('|', id, program_id, stage, round, master_sample,
                                                   sent_date, due_back, comment, created_by, created_at,
                                                   updated_by, updated_at), '/' order by id), '')) || '/' ||
                 count(tracking_number)::text
            from vessl.program_sample_rounds),
         (select rows_before::text || '/' || hash_before || '/0' from _pre82)
  union all
  -- THE GRANT, WHOLE. Only the owner and authenticated, and authenticated holds
  -- exactly arwd.
  select 'c1 the ACL is exactly the owner plus authenticated arwd',
         (select relacl::text from pg_class where oid = 'vessl.program_sample_rounds'::regclass),
         '{postgres=arwdDxtm/postgres,authenticated=arwd/postgres}'
  union all
  select 'c1b and the only change from before is the delete bit',
         (select acl_before::text from _pre82), '{postgres=arwdDxtm/postgres,authenticated=arw/postgres}'
  union all
  select 'c1c authenticated may delete and still may not truncate, anon reaches nothing',
         (select has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'DELETE')::text || '/' ||
                 has_table_privilege('authenticated', 'vessl.program_sample_rounds', 'TRUNCATE')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_sample_rounds', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.program_sample_rounds', 'DELETE')::text),
         'true/false/false/false'
  union all
  select 'c2 row level security is still on and not forced',
         (select relrowsecurity::text || '/' || relforcerowsecurity::text
            from pg_class where oid = 'vessl.program_sample_rounds'::regclass), 'true/false'
  union all
  select 'c3 still one policy, staff_only, permissive, all commands, is_staff both ways',
         (select string_agg(polname || '/' || polpermissive::text || '/' || polcmd::text || '/'
                            || pg_get_expr(polqual, polrelid) || '/' || pg_get_expr(polwithcheck, polrelid), ', ')
            from pg_policy where polrelid = 'vessl.program_sample_rounds'::regclass),
         'staff_only/true/*/vessl.is_staff()/vessl.is_staff()'
  union all
  select 'c4 the four constraints are unchanged',
         (select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' / ' order by conname)
            from pg_constraint where conrelid = 'vessl.program_sample_rounds'::regclass),
         (select cons_before from _pre82)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
