-- 112 -- Sample rounds say who sent the package, in program_sample_rounds.sent_by.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 112r.
--
-- WHAT IT DOES. One column and its CHECK, nothing else.
--   sent_by, nullable text, no default. us is KUI, them is the other side,
--   NULL is Not set. The CHECK is program_sample_rounds_sent_by_check and allows
--   only us, them or NULL. Every existing round reads NULL -- no backfill.
--
-- NO GRANT CHANGES. Scripts 80 and 82 granted select, insert, update and delete
-- to authenticated ON THE TABLE, not column by column, and a table grant covers
-- a column added later. The guard checks that no column of the table carries a
-- column-level grant (pg_attribute.attacl is null on every column), so there is
-- no column list the new column would be missing from. The staff_only policy is
-- FOR ALL and names no columns. Probe p1 proves a signed-in staff user can write
-- it.
--
-- GUARDS, before any change.
--   sent_by does not exist yet
--   no column of the table has a column-level grant
--   there is at least one round, for the probes to use
--
-- PROBES, each undone. As Jenn signed in through the app (authenticated, a
-- kinguniversal.com identity) -- us, then them, then back to NULL, each accepted.
-- As postgres, kui and an empty string are each refused by the CHECK (23514).
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a or b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre112 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name = 'sent_by')                                                             as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.program_sample_rounds'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds,
    (select id from vessl.program_sample_rounds order by id limit 1)                             as probe_id,
    -- Every round, every column, so b3 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rows;

do $guard$
begin
  if (select has_col from _pre112) <> 0 then
    raise exception 'sent_by already exists, nothing changed';
  end if;
  if (select n_colacl from _pre112) <> 0 then
    raise exception 'a column of program_sample_rounds has a column-level grant, so the new column may need one too, nothing changed';
  end if;
  if (select n_rounds from _pre112) < 1 then
    raise exception 'no rounds to probe with, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds add column sent_by text;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_sent_by_check
  check (sent_by is null or sent_by = any (array['us', 'them']));
comment on column vessl.program_sample_rounds.sent_by is
  'Who sent the package for this round -- us (KUI) or them (script 112). NULL is Not set.';

create temp table _probe112 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  pid uuid := (select probe_id from _pre112);
  st text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 to p3, as a signed-in staff user -- us, them, back to blank.
  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds set sent_by = 'us' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe112 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds set sent_by = 'them' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe112 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds set sent_by = 'us' where id = pid;
    update vessl.program_sample_rounds set sent_by = null where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe112 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p4 and p5, as postgres -- anything else is refused by the CHECK.
  begin
    update vessl.program_sample_rounds set sent_by = 'kui' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe112 values (4, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    update vessl.program_sample_rounds set sent_by = '' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe112 values (5, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, no sent_by, no column-level grants, at least one round' as chk,
         (select has_col::text || '/' || n_colacl::text || '/' || (n_rounds > 0)::text from _pre112) as got,
         '0/0/true' as want
  union all
  select 'b1 sent_by exists, is text, nullable, no default',
         (select data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds' and column_name = 'sent_by'),
         'text/YES/none'
  union all
  select 'b2 the CHECK exists, is validated, and allows only us, them or null',
         (select convalidated::text || '/' || pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_sent_by_check'),
         'true/CHECK (((sent_by IS NULL) OR (sent_by = ANY (ARRAY[''us''::text, ''them''::text]))))'
  union all
  select 'b3 every existing round unchanged, sent_by blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(r) - 'sent_by')::text, '/' order by r.id), ''))
                           = (select h_rows from _pre112) then 'same' else 'changed' end
                 || '/' || count(*) filter (where sent_by is not null)::text
            from vessl.program_sample_rounds r),
         'same/0'
  union all
  select 'b4 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre112)
  union all
  select 'b5 probes -- staff can set us, them and blank; kui and empty refused',
         (select string_agg(result, ' | ' order by step) from _probe112),
         'allowed 1 | allowed 1 | allowed 1 | 23514 | 23514'
  union all
  select 'b6 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.program_sample_rounds'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
