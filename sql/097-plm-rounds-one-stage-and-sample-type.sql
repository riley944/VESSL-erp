-- 97 -- PLM sample rounds, every round is a Sampling round, and each gets a sample type.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 97r.
--
-- WHY. Revision folds into Sampling (1 Oct). Script 80 tied round 1 to stage
-- sampling and round 2 and up to stage revision, and that CHECK would refuse a
-- round 2 written as sampling. The Master sample Yes or No is replaced by a
-- sample type on every round.
--
-- WHAT IT DOES
--   1. Replaces program_sample_rounds_round_stage_check, same name, with
--      round 1 or higher, and stage sampling or revision. Revision stays
--      allowed so the old rule can come back (97r) and so the board code that
--      still writes revision for round 2 and up keeps working until stage 3.
--   2. Moves the one revision round to sampling, by id -- ZZTESTPLM round 2.
--      Not stamped as an edit -- updated_at and updated_by are left alone,
--      because nobody edited the round.
--   3. Adds sample_type, nullable text, with a CHECK on the five keys --
--      first, pre_production, production, testing_production, testing.
--      Existing rounds read Not set. master_sample and comment are untouched
--      and left unread by the code from stage 3 on.
--
-- GUARDS, before any change.
--   the round CHECK hashes to the value measured on 1 Oct
--   sample_type does not exist yet
--   exactly two rounds -- JO-118 round 1 sampling, ZZTESTPLM round 2 revision
--
-- PROBES, each undone. A round 3 written as sampling is accepted, a sample type
-- from the list is accepted, a type off the list, a round 0 and a stage of
-- testing are each refused.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre97 on commit drop as
  select
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_round_stage_check')                                 as h_check,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name = 'sample_type')                                                         as has_type,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds,
    (select count(*) from vessl.program_sample_rounds
      where id = '790965c1-373b-4c41-b490-8d18ddf9ea04'::uuid
        and program_id = 'c34fa69d-04b8-4399-ae92-172c28004c0f'::uuid
        and round = 1 and stage = 'sampling')
      || '/' || (select count(*) from vessl.program_sample_rounds
      where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid
        and program_id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
        and round = 2 and stage = 'revision')                                                    as ident,
    -- Every round, every column but stage, so b3 can prove only stage moved.
    (select md5(coalesce(string_agg((to_jsonb(r) - 'stage')::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rest;

do $guard$
begin
  if (select h_check from _pre97) is distinct from '0b7bddf65d0574a9a0055decaacf8962' then
    raise exception 'the round CHECK is not the script 80 one measured on 1 Oct, nothing changed';
  end if;
  if (select has_type from _pre97) <> 0 then
    raise exception 'sample_type already exists, nothing changed';
  end if;
  if (select n_rounds from _pre97) <> 2 or (select ident from _pre97) is distinct from '1/1' then
    raise exception 'the rounds are not JO-118 round 1 and ZZTESTPLM round 2 as measured, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_round_stage_check;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_round_stage_check
  check (round >= 1 and stage = any (array['sampling', 'revision']));

update vessl.program_sample_rounds
   set stage = 'sampling'
 where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid
   and stage = 'revision';

alter table vessl.program_sample_rounds add column sample_type text;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_sample_type_check
  check (sample_type is null or sample_type = any (array['first', 'pre_production', 'production',
                                                         'testing_production', 'testing']));
comment on column vessl.program_sample_rounds.sample_type is
  'What was sent in this round -- first, pre_production, production, testing_production or testing (script 97). Replaces master_sample, which is no longer read. NULL is Not set.';

create temp table _probe97 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
begin
  begin
    insert into vessl.program_sample_rounds (program_id, stage, round)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 'sampling', 3);
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe97 values (1, 'refused');
    when raise_exception then insert into _probe97 select 1, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    update vessl.program_sample_rounds set sample_type = 'pre_production'
     where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe97 values (2, 'refused');
    when raise_exception then insert into _probe97 select 2, case when n = 1 then 'ok' else 'norow' end;
  end;

  begin
    update vessl.program_sample_rounds set sample_type = 'golden'
     where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe97 values (3, 'refused');
    when raise_exception then insert into _probe97 select 3, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    insert into vessl.program_sample_rounds (program_id, stage, round)
    values ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, 'sampling', 0);
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe97 values (4, 'refused');
    when raise_exception then insert into _probe97 select 4, case when n = 1 then 'accepted' else 'norow' end;
  end;

  begin
    update vessl.program_sample_rounds set stage = 'testing'
     where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe97 values (5, 'refused');
    when raise_exception then insert into _probe97 select 5, case when n = 1 then 'accepted' else 'norow' end;
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 script 80 CHECK, no sample_type yet, two rounds as measured' as chk,
         (select (h_check = '0b7bddf65d0574a9a0055decaacf8962')::text || '/' || has_type::text
                 || '/' || n_rounds::text || '/' || ident from _pre97) as got,
         'true/0/2/1/1' as want
  union all
  select 'b1 both rounds are stage sampling now -- JO-118 round 1, ZZTESTPLM round 2',
         (select string_agg(round::text || ' ' || stage, '/' order by round) from vessl.program_sample_rounds
           where id in ('790965c1-373b-4c41-b490-8d18ddf9ea04'::uuid, '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid)),
         '1 sampling/2 sampling'
  union all
  select 'b2 sample_type exists, is text, and every round is Not set',
         (select (select data_type from information_schema.columns
                   where table_schema = 'vessl' and table_name = 'program_sample_rounds'
                     and column_name = 'sample_type')
                 || '/' || (select count(*) from vessl.program_sample_rounds where sample_type is not null)::text),
         'text/0'
  union all
  select 'b3 nothing else on any round moved -- every column but stage and sample_type',
         (select md5(coalesce(string_agg((to_jsonb(r) - 'stage' - 'sample_type')::text, '/' order by r.id), ''))
            from vessl.program_sample_rounds r),
         (select h_rest from _pre97)
  union all
  select 'b4 both CHECKs exist and are validated',
         (select count(*)::text || '/' || bool_and(convalidated)::text from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname in ('program_sample_rounds_round_stage_check', 'program_sample_rounds_sample_type_check')),
         '2/true'
  union all
  select 'b5 probes -- round 3 sampling ok, a listed type ok, a junk type, round 0 and stage testing refused',
         (select string_agg(result, '/' order by step) from _probe97), 'ok/ok/refused/refused/refused'
  union all
  select 'b6 the probes left nothing -- still two rounds',
         (select count(*)::text from vessl.program_sample_rounds), '2'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
