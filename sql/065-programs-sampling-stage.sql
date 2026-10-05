-- 65 -- three sample rungs become one Sampling stage.
--
-- WHAT THE CHECK ALLOWS TODAY, re-measured against the live database rather than
-- taken from script 60
--   declared_stage IS NULL OR declared_stage = ANY (ARRAY[
--     quoted, sample_1, sample_2, sample_3, sample_4, sample_5,
--     testing, purchase_order, complete ])
-- Nine values plus null, which is what 60 widened it to.
--
-- WHAT IT BECOMES
--   null, quoted, sampling, testing, purchase_order, complete
-- Five values plus null. The five numbered rungs go, and one sampling takes their
-- place.
--
-- WHY. The numbered rungs were built on the reasoning that a sample round is the
-- thing that repeats at KUI and a single column could not say whether a card had
-- been round once or three times. In practice nobody used the fourth or fifth, the
-- UI capped at three, and counting rounds turned out to be a thing people track in
-- the notes rather than by moving a card. One stage that means sampling is
-- happening is the honest shape.
--
-- HOW MANY ROWS MOVE. Zero. Measured now rather than assumed -- vessl.programs
-- holds ONE row and it sits on quoted. The migration below is written anyway,
-- because a card created between this being written and being run would otherwise
-- be stranded on a value the new CHECK refuses, and the alter would fail rather
-- than silently leaving it. b1 asserts the migration moved exactly what was there
-- to move.
--
-- ORDER MATTERS. The rows move FIRST and the constraint is replaced after. Doing
-- it the other way round fails on any row still holding a numbered rung, which is
-- the same lesson the PLM rework recorded about doors and scripts.
--
-- COUNTS ARE ASSERTED AS DIFFERENCES where they can move, and the probe proves the
-- new constraint by trying it rather than by reading it.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.programs -- 1 row, on quoted. 0 rows on any of sample_1 to sample_5.
--   programs_declared_stage_check present, with the nine values above.
--   programs_factory_pct_check also present and untouched by this script.

begin;

-- PRE-STATE FIRST, counted before anything is written.
create temp table _pre65 on commit drop as
  select (select count(*) from vessl.programs)                                as programs_before,
         (select count(*) from vessl.programs
           where declared_stage in ('sample_1','sample_2','sample_3','sample_4','sample_5'))
                                                                              as on_rungs_before,
         (select count(*) from vessl.programs where declared_stage = 'sampling')
                                                                              as on_sampling_before,
         (select count(*) from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_declared_stage_check'
             and pg_get_constraintdef(oid) like '%sample_5%')                 as had_old_check;

-- REFUSE rather than replace a constraint that is not the one measured.
do $guard$
begin
  if (select had_old_check from _pre65) <> 1 then
    raise exception 'the declared_stage CHECK is not the nine value one measured, nothing changed';
  end if;
  if (select on_sampling_before from _pre65) <> 0 then
    raise exception 'something already sits on sampling, so this is not the first run, nothing changed';
  end if;
end
$guard$;

-- 1. MOVE THE ROWS FIRST. Every numbered rung becomes sampling. Zero rows today,
--    and the statement is here for the card somebody might make tomorrow.
update vessl.programs
   set declared_stage = 'sampling',
       updated_at = now()
 where declared_stage in ('sample_1','sample_2','sample_3','sample_4','sample_5');

-- 2. THEN REPLACE THE CONSTRAINT. Dropped and recreated rather than altered,
--    because a CHECK cannot be changed in place.
alter table vessl.programs
  drop constraint programs_declared_stage_check;
alter table vessl.programs
  add constraint programs_declared_stage_check
  check (declared_stage is null or declared_stage in
         ('quoted','sampling','testing','purchase_order','complete'));

-- ── PROBE, undone even on commit ────────────────────────────────────────────
-- The catalogue can say what the constraint reads. Only trying it says what it
-- does. Each attempt runs in a subtransaction forced to roll back; the plpgsql
-- variables survive that rollback, which is what carries the answers out.
--
-- A product and client pair with no card is chosen so the insert cannot trip the
-- UNIQUE (product_id, client_company_id) for a reason unrelated to the CHECK.
-- created_at and updated_at are written with now() rather than left to a default,
-- both being NOT NULL, and a timestamp literal would carry single colons.
create temp table _probe65 (name text, got text) on commit drop;

do $probe$
declare
  pid uuid; cid uuid;
  new_ok text := 'no'; old_refused text := 'no';
begin
  select p.id, c.id into pid, cid
    from vessl.products p cross join vessl.companies c
   where not exists (select 1 from vessl.programs g
                      where g.product_id = p.id and g.client_company_id = c.id)
   limit 1;

  if pid is null or cid is null then
    insert into _probe65 values ('sampling accepted', 'no free pair'),
                                ('a numbered rung refused', 'no free pair');
    return;
  end if;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, archived,
                                created_at, updated_at)
    values (pid, cid, 'sampling', false, now(), now());
    new_ok := 'yes';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when check_violation then new_ok := 'no';
  end;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, archived,
                                created_at, updated_at)
    values (pid, cid, 'sample_1', false, now(), now());
    old_refused := 'no';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when check_violation then old_refused := 'yes';
  end;

  insert into _probe65 values ('sampling accepted', new_ok),
                              ('a numbered rung refused', old_refused);
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the nine value CHECK was there before' as chk,
         (select had_old_check::text from _pre65) as got, '1' as want
  union all
  select 'a1 no card sat on a numbered rung before',
         (select on_rungs_before::text from _pre65), '0'
  union all
  select 'b1 every rung row moved to sampling, and only those',
         (select ((select count(*) from vessl.programs where declared_stage = 'sampling')
                - (select on_sampling_before from _pre65))::text
              || '/' || (select on_rungs_before::text from _pre65)), '0/0'
  union all
  select 'b2 the new CHECK names all five stages',
         (select count(*)::text from unnest(array['quoted','sampling','testing','purchase_order','complete']) v
           where (select pg_get_constraintdef(oid) from pg_constraint
                   where conrelid = 'vessl.programs'::regclass
                     and conname = 'programs_declared_stage_check') like '%' || v || '%'), '5'
  union all
  select 'b3 and no numbered rung survives in it',
         (select count(*)::text from unnest(array['sample_1','sample_2','sample_3','sample_4','sample_5']) v
           where (select pg_get_constraintdef(oid) from pg_constraint
                   where conrelid = 'vessl.programs'::regclass
                     and conname = 'programs_declared_stage_check') like '%' || v || '%'), '0'
  union all
  select 'b4 sampling inserts and a numbered rung does not',
         (select (select got from _probe65 where name = 'sampling accepted') || '/'
              || (select got from _probe65 where name = 'a numbered rung refused')), 'yes/yes'
  union all
  select 'b5 no card is left on a value the CHECK refuses',
         (select count(*)::text from vessl.programs
           where declared_stage is not null
             and declared_stage not in ('quoted','sampling','testing','purchase_order','complete')), '0'
  union all
  -- The other CHECK on this table is script 49 work and must survive untouched.
  select 'b6 the factory_pct CHECK is still attached',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.programs'::regclass
             and conname = 'programs_factory_pct_check'), '1'
  union all
  select 'c1 no program row created or deleted',
         (select ((select count(*) from vessl.programs) - (select programs_before from _pre65))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
