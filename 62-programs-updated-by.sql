-- 62 -- who touched the card last.
--
-- WHAT IT DOES. Adds vessl.programs.updated_by, text, NULL. One column, nothing
-- else. updated_at has been on the table since the beginning and the app has been
-- stamping it by hand on every write; what was missing was the name beside it, so
-- a card could say when it last moved but never who moved it.
--
-- NULL IS A REAL VALUE HERE and the column is deliberately nullable. Every row
-- that exists today predates the stamp, and backfilling a name onto a change
-- nobody recorded would be inventing evidence. An empty last touch reads as not
-- recorded, which is exactly what it is.
--
-- TEXT, NOT A KEY INTO staff_profiles. owner_id is a key because an owner is a
-- person the board assigns work to and a typo there would break a filter. This is
-- an audit crumb, recording the address that made the change, which must stay
-- readable even if that colleague later leaves and their profile goes. The
-- interface resolves it to a full name when the address matches a profile and
-- shows the raw address when it does not.
--
-- NO TRIGGER. The only trigger on this table is trg_programs_declared_stage_at,
-- which stamps declared_stage_at on insert and on a stage change. Nothing stamps
-- updated_at either -- the application does both by hand, on every write, which is
-- what the code change beside this script extends to updated_by.
--
-- COUNTS ARE ASSERTED AS DIFFERENCES, NOT ABSOLUTES. The table held zero rows this
-- morning and holds one now, because a card was made while testing. An absolute
-- want would fail a good run for a reason that has nothing to do with this script.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.programs -- 13 columns, no updated_by, 1 row.
--   vessl.program_notes -- 0 rows.
--   One trigger, trg_programs_declared_stage_at.

begin;

-- PRE-STATE FIRST, counted before the alter, so c1 and c2 measure this script
-- rather than reporting what it just did.
create temp table _pre62 on commit drop as
  select (select count(*) from vessl.programs)                            as programs_before,
         (select count(*) from vessl.program_notes)                       as notes_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs')      as cols_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'updated_by')                              as had_col;

-- REFUSE rather than alter a table that is not the one measured.
do $guard$
begin
  if (select had_col from _pre62) <> 0 then
    raise exception 'programs already carries updated_by, nothing changed';
  end if;
  if (select cols_before from _pre62) <> 13 then
    raise exception 'programs is not the thirteen column table measured, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs add column updated_by text;

-- ── PROBE, undone even on commit ────────────────────────────────────────────
-- One question the catalogue cannot answer, which is whether a row can actually
-- carry a value in the new column. It runs inside a subtransaction forced to roll
-- back, so nothing survives it. The plpgsql variable does survive, which is what
-- carries the answer out. Column list FIRST, then on commit drop.
--
-- created_at and updated_at are written with now() rather than left to a default,
-- because both are NOT NULL and this probe must fail for the reason it is testing
-- or not at all. A timestamp literal would carry single colons, which the SQL
-- editor rewrites as bind parameters -- the fault that cost script 58 a rehearsal.
create temp table _probe62 (name text, got text) on commit drop;

do $probe$
declare
  pid uuid; cid uuid; wrote text := 'no';
begin
  -- A product and client pair with no card yet, so the insert cannot trip the
  -- UNIQUE (product_id, client_company_id) for a reason unrelated to the column.
  select p.id, c.id into pid, cid
    from vessl.products p cross join vessl.companies c
   where not exists (select 1 from vessl.programs g
                      where g.product_id = p.id and g.client_company_id = c.id)
   limit 1;

  if pid is null or cid is null then
    insert into _probe62 values ('a row accepts updated_by', 'no free pair');
    return;
  end if;

  begin
    insert into vessl.programs (product_id, client_company_id, declared_stage, archived,
                                created_at, updated_at, updated_by)
    values (pid, cid, 'quoted', false, now(), now(), 'probe');
    wrote := 'yes';
    raise exception using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then wrote := 'no';
  end;

  insert into _probe62 values ('a row accepts updated_by', wrote);
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 programs had no updated_by before' as chk,
         (select had_col::text from _pre62) as got, '0' as want
  union all
  select 'a1 thirteen columns before',
         (select cols_before::text from _pre62), '13'
  union all
  select 'b1 updated_by exists, is text, and is nullable',
         (select data_type || '/' || is_nullable from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs' and column_name = 'updated_by'),
         'text/YES'
  union all
  select 'b2 fourteen columns now',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'), '14'
  union all
  select 'b3 a row accepts a value in the new column',
         (select got::text from _probe62 where name = 'a row accepts updated_by'), 'yes'
  union all
  -- DIFFERENCES, not absolutes. A card made or removed between writing this and
  -- running it must not fail a correct run.
  select 'c1 no program row created or deleted',
         (select ((select count(*) from vessl.programs) - (select programs_before from _pre62))::text), '0'
  union all
  select 'c2 program notes unchanged',
         (select ((select count(*) from vessl.program_notes) - (select notes_before from _pre62))::text), '0'
  union all
  -- The stamp trigger is script 49 work and this script must not disturb it.
  select 'c3 the declared_stage_at trigger is still attached',
         (select count(*)::text from pg_trigger
           where tgrelid = 'vessl.programs'::regclass and tgname = 'trg_programs_declared_stage_at'), '1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
