-- 112r -- Reverse 112. program_sample_rounds.sent_by and its CHECK are dropped.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 112. One transaction.
--
-- WHAT IT DOES. Drops program_sample_rounds_sent_by_check, then the sent_by
-- column. Every Sent by recorded since 112 is LOST -- the guard reports how many
-- rounds hold one, and a0 shows the count, so read it on the rehearsal before
-- swapping to commit. No other column, row or grant is touched.
--
-- THE CODE FIRST. The Samples page names sent_by when it loads and saves a
-- round. It falls back to loading without it, but take the code out first so a
-- save with Sent by chosen is not refused.
--
-- GUARD. sent_by exists and its CHECK is the 112 one.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0. Any b row is a failed check. Zero
-- rows means the query did not run. a0 always shows, with how many rounds lose a value.

begin;

create temp table _pre112r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name = 'sent_by')                                                             as has_col,
    (select count(*) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_sent_by_check')                                     as has_check,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds;

do $guard$
begin
  if (select has_col from _pre112r) <> 1 or (select has_check from _pre112r) <> 1 then
    raise exception 'sent_by or its CHECK is missing, so 112 is not as it left things, nothing changed';
  end if;
end
$guard$;

-- How many rounds hold a value, read before the column goes.
create temp table _lost112r on commit drop as
  select count(*) as n_set from vessl.program_sample_rounds where sent_by is not null;

-- Every round, every column but sent_by, so b3 can prove nothing else moved.
create temp table _rest112r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(r) - 'sent_by')::text, '/' order by r.id), '')) as h_rest
    from vessl.program_sample_rounds r;

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_sent_by_check;
alter table vessl.program_sample_rounds drop column sent_by;

-- VERIFICATION. a0 (always shown, with the count) and z0 are a pass. Any b row is a
-- failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, sent_by and its CHECK present; rounds losing a value = '
           || (select n_set::text from _lost112r) as chk,
         (select has_col::text || '/' || has_check::text from _pre112r) as got,
         '1/1' as want
  union all
  select 'b1 sent_by is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds' and column_name = 'sent_by'),
         '0'
  union all
  select 'b2 its CHECK is gone',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_sent_by_check'),
         '0'
  union all
  select 'b3 every other column on every round unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                           = (select h_rest from _rest112r) then 'same' else 'changed' end
            from vessl.program_sample_rounds r),
         'same'
  union all
  select 'b4 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre112r)
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
