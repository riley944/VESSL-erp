-- 97r -- Reverse 97. Rounds go back to round 1 sampling and round 2 up revision, and sample_type goes.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 97. One transaction.
--
-- WHAT IT DOES
--   1. Drops sample_type and its CHECK.
--   2. Puts every round back on the script 80 rule by its number -- round 1 to
--      sampling, round 2 and up to revision. That is the old rule applied to
--      every round, not only the one 97 moved, because from stage 3 on the board
--      writes sampling for every new round.
--   3. Restores program_sample_rounds_round_stage_check exactly as script 80
--      had it.
--
-- GUARDS, before any change.
--   sample_type exists and NO round has one set. Dropping the column would lose
--   that work, so this stops and says how many -- clear them by hand first if
--   undoing is really wanted
--   the round CHECK is not the script 80 one, which proves 97 ran
--   no round is numbered below 1
--
-- AFTER. b1 is the strong check -- the CHECK hashes to exactly the script 80
-- value measured on 1 Oct. b3 proves no column but stage moved on any round.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre97r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name = 'sample_type')                                                         as has_type,
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_round_stage_check')                                 as h_check,
    (select count(*) from vessl.program_sample_rounds where round < 1)                           as n_low,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds,
    (select count(*) from vessl.program_sample_rounds
      where (round = 1 and stage <> 'sampling') or (round >= 2 and stage <> 'revision'))         as n_to_move;

-- Read through to_jsonb so this parses whether or not sample_type exists.
create temp table _typed97r on commit drop as
  select count(*) as n_typed
    from vessl.program_sample_rounds r
   where (to_jsonb(r) ->> 'sample_type') is not null;

create temp table _rest97r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(r) - 'stage' - 'sample_type')::text, '/' order by r.id), '')) as h_rest
    from vessl.program_sample_rounds r;

do $guard$
begin
  if (select has_type from _pre97r) <> 1 then
    raise exception 'sample_type does not exist, so 97 is not in place, nothing changed';
  end if;
  if (select n_typed from _typed97r) <> 0 then
    raise exception '% round(s) have a sample type set, and dropping the column would lose them -- nothing changed',
      (select n_typed from _typed97r);
  end if;
  if (select h_check from _pre97r) is not distinct from '0b7bddf65d0574a9a0055decaacf8962' then
    raise exception 'the round CHECK is already the script 80 one, nothing changed';
  end if;
  if (select n_low from _pre97r) <> 0 then
    raise exception 'a round is numbered below 1, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_sample_type_check;
alter table vessl.program_sample_rounds drop column sample_type;

update vessl.program_sample_rounds
   set stage = case when round = 1 then 'sampling' else 'revision' end
 where (round = 1 and stage <> 'sampling') or (round >= 2 and stage <> 'revision');

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_round_stage_check;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_round_stage_check
  check (((round = 1) and (stage = 'sampling')) or ((round >= 2) and (stage = 'revision')));

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 sample_type existed, none set, CHECK was the 97 one, no round below 1' as chk,
         (select p.has_type::text || '/' || t.n_typed::text || '/'
                 || (p.h_check is distinct from '0b7bddf65d0574a9a0055decaacf8962')::text || '/' || p.n_low::text
            from _pre97r p, _typed97r t) as got,
         '1/0/true/0' as want
  union all
  select 'b1 the round CHECK hashes to the script 80 value and is validated',
         (select (md5(pg_get_constraintdef(oid)) = '0b7bddf65d0574a9a0055decaacf8962')::text || '/' || convalidated::text
            from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_round_stage_check'),
         'true/true'
  union all
  select 'b2 sample_type and its CHECK are gone',
         (select (select count(*) from information_schema.columns
                   where table_schema = 'vessl' and table_name = 'program_sample_rounds'
                     and column_name = 'sample_type')::text
                 || '/' || (select count(*) from pg_constraint
                             where conrelid = 'vessl.program_sample_rounds'::regclass
                               and conname = 'program_sample_rounds_sample_type_check')::text),
         '0/0'
  union all
  select 'b3 nothing but stage moved on any round, and the count is unchanged',
         (select md5(coalesce(string_agg((to_jsonb(r) - 'stage')::text, '/' order by r.id), ''))
                 || '/' || count(*)::text
            from vessl.program_sample_rounds r),
         (select x.h_rest || '/' || p.n_rounds::text from _rest97r x, _pre97r p)
  union all
  select 'b4 every round follows the script 80 rule',
         (select count(*)::text from vessl.program_sample_rounds
           where (round = 1 and stage <> 'sampling') or (round >= 2 and stage <> 'revision')),
         '0'
  union all
  select 'r1 rounds moved back to their old stage',
         (select n_to_move::text from _pre97r), 'shown every run'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
