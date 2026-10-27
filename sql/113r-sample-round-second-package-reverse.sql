-- 113r -- Reverse 113. sent_by_2, carrier_2, tracking_number_2 and the sent_by_2 CHECK are dropped.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 113. One transaction.
--
-- WHAT IT DOES. Drops program_sample_rounds_sent_by_2_check, then the three
-- second-package columns. Every second package recorded since 113 is LOST -- a0
-- shows how many rounds hold one, so read it on the rehearsal before swapping to
-- commit. sent_by (script 112) and every other column, row and grant stay.
--
-- THE CODE FIRST. The Samples page names these columns when it loads and saves a
-- round. It falls back to loading without them, but take the code out first so a
-- save with a second package filled in is not refused.
--
-- GUARD. All three columns and the CHECK exist.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0. Any b row is a failed check. Zero
-- rows means the query did not run. a0 always shows, with how many rounds lose a value.

begin;

create temp table _pre113r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name in ('sent_by_2', 'carrier_2', 'tracking_number_2'))                      as has_cols,
    (select count(*) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_sent_by_2_check')                                   as has_check,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds;

do $guard$
begin
  if (select has_cols from _pre113r) <> 3 or (select has_check from _pre113r) <> 1 then
    raise exception 'a second-package column or its CHECK is missing, so 113 is not as it left things, nothing changed';
  end if;
end
$guard$;

-- How many rounds hold a second-package value, read before the columns go.
create temp table _lost113r on commit drop as
  select count(*) as n_set from vessl.program_sample_rounds
   where sent_by_2 is not null or carrier_2 is not null or tracking_number_2 is not null;

-- Every round, every column but the three, so b3 can prove nothing else moved.
create temp table _rest113r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(r) - 'sent_by_2' - 'carrier_2' - 'tracking_number_2')::text,
                                 '/' order by r.id), '')) as h_rest
    from vessl.program_sample_rounds r;

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_sent_by_2_check;
alter table vessl.program_sample_rounds drop column sent_by_2;
alter table vessl.program_sample_rounds drop column carrier_2;
alter table vessl.program_sample_rounds drop column tracking_number_2;

-- VERIFICATION. a0 (always shown, with the count) and z0 are a pass. Any b row is a
-- failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, three columns and the CHECK present; rounds losing a value = '
           || (select n_set::text from _lost113r) as chk,
         (select has_cols::text || '/' || has_check::text from _pre113r) as got,
         '3/1' as want
  union all
  select 'b1 the three columns are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name in ('sent_by_2', 'carrier_2', 'tracking_number_2')),
         '0'
  union all
  select 'b2 its CHECK is gone',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_sent_by_2_check'),
         '0'
  union all
  select 'b3 every other column on every round unchanged, sent_by included',
         (select case when md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                           = (select h_rest from _rest113r) then 'same' else 'changed' end
            from vessl.program_sample_rounds r),
         'same'
  union all
  select 'b4 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre113r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk like 'a0%'
   or chk = 'z0 verification ran'
order by chk;

-- Two rows, a0 and z0, and the count is what you expect? Then swap these two lines.
-- commit;
rollback;
