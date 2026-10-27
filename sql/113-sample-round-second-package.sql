-- 113 -- Sample rounds record a second package, in sent_by_2, carrier_2 and tracking_number_2.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 113r.
--
-- WHAT IT DOES. Three columns and one CHECK, nothing else.
--   sent_by_2, nullable text, no default, with program_sample_rounds_sent_by_2_check
--     allowing only us, them or NULL -- the same rule script 112 put on sent_by.
--   carrier_2, nullable text, no default -- the carrier NAME, as carrier is.
--   tracking_number_2, nullable text, no default.
-- Every existing round reads NULL in all three -- no backfill.
--
-- NO GRANT CHANGES. Scripts 80 and 82 granted select, insert, update and delete
-- to authenticated ON THE TABLE, and a table grant covers columns added later.
-- The guard checks that no column of the table carries a column-level grant
-- (pg_attribute.attacl is null on every column). Measured read-only 12 Oct, none
-- did. The staff_only policy is FOR ALL and names no columns. Probe p1 proves a
-- signed-in staff user can write all three.
--
-- GUARDS, before any change.
--   script 112 has run -- sent_by and its CHECK exist
--   none of the three new columns exists yet
--   no column of the table has a column-level grant
--   there is at least one round, for the probes to use
--
-- PROBES, each undone. As Jenn signed in through the app (authenticated, a
-- kinguniversal.com identity) -- all three set, then all three back to NULL, each
-- accepted. As postgres, a sent_by_2 of kui and of an empty string are each
-- refused by the CHECK (23514).
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a or b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre113 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name = 'sent_by')
      + (select count(*) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_sent_by_check')                                     as has_112,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name in ('sent_by_2', 'carrier_2', 'tracking_number_2'))                      as has_new,
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
  if (select has_112 from _pre113) <> 2 then
    raise exception 'sent_by or its CHECK is missing, so script 112 has not run, nothing changed';
  end if;
  if (select has_new from _pre113) <> 0 then
    raise exception 'a second-package column already exists, nothing changed';
  end if;
  if (select n_colacl from _pre113) <> 0 then
    raise exception 'a column of program_sample_rounds has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
  if (select n_rounds from _pre113) < 1 then
    raise exception 'no rounds to probe with, nothing changed';
  end if;
end
$guard$;

alter table vessl.program_sample_rounds add column sent_by_2 text;
alter table vessl.program_sample_rounds add column carrier_2 text;
alter table vessl.program_sample_rounds add column tracking_number_2 text;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_sent_by_2_check
  check (sent_by_2 is null or sent_by_2 = any (array['us', 'them']));
comment on column vessl.program_sample_rounds.sent_by_2 is
  'Who sent the second package for this round -- us (KUI) or them (script 113). NULL is Not set.';
comment on column vessl.program_sample_rounds.carrier_2 is
  'The carrier of the second package, by name, as carrier is (script 113).';
comment on column vessl.program_sample_rounds.tracking_number_2 is
  'The tracking number of the second package (script 113).';

create temp table _probe113 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  pid uuid := (select probe_id from _pre113);
  st text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 and p2, as a signed-in staff user -- all three set, then all three blank.
  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds
       set sent_by_2 = 'them', carrier_2 = 'Probe carrier', tracking_number_2 = 'PROBE113'
     where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe113 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds
       set sent_by_2 = 'us', carrier_2 = 'Probe carrier', tracking_number_2 = 'PROBE113'
     where id = pid;
    update vessl.program_sample_rounds
       set sent_by_2 = null, carrier_2 = null, tracking_number_2 = null
     where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe113 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p3 and p4, as postgres -- anything else in sent_by_2 is refused by the CHECK.
  begin
    update vessl.program_sample_rounds set sent_by_2 = 'kui' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe113 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    update vessl.program_sample_rounds set sent_by_2 = '' where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe113 values (4, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, 112 in place, no new columns, no column-level grants, at least one round' as chk,
         (select has_112::text || '/' || has_new::text || '/' || n_colacl::text || '/' || (n_rounds > 0)::text from _pre113) as got,
         '2/0/0/true' as want
  union all
  select 'b1 the three columns exist, text, nullable, no default',
         (select string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, 'none'),
                            '/' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name in ('sent_by_2', 'carrier_2', 'tracking_number_2')),
         'carrier_2 text YES none/sent_by_2 text YES none/tracking_number_2 text YES none'
  union all
  select 'b2 the CHECK exists, is validated, and allows only us, them or null',
         (select convalidated::text || '/' || pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'vessl.program_sample_rounds'::regclass
             and conname = 'program_sample_rounds_sent_by_2_check'),
         'true/CHECK (((sent_by_2 IS NULL) OR (sent_by_2 = ANY (ARRAY[''us''::text, ''them''::text]))))'
  union all
  select 'b3 every existing round unchanged, the three new columns blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(r) - 'sent_by_2' - 'carrier_2' - 'tracking_number_2')::text,
                                                   '/' order by r.id), ''))
                           = (select h_rows from _pre113) then 'same' else 'changed' end
                 || '/' || count(*) filter (where sent_by_2 is not null or carrier_2 is not null
                                               or tracking_number_2 is not null)::text
            from vessl.program_sample_rounds r),
         'same/0'
  union all
  select 'b4 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre113)
  union all
  select 'b5 probes -- staff can set and clear all three; kui and empty refused',
         (select string_agg(result, ' | ' order by step) from _probe113),
         'allowed 1 | allowed 1 | 23514 | 23514'
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
