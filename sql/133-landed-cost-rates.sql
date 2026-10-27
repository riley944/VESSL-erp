-- 133 -- Landed-cost rates on vessl.kui_settings.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 133r.
-- Run this BEFORE the code that reads it is deployed -- the bid comparison and
-- Settings read and write these columns. The code now live never names them, so
-- adding them changes nothing for the live site.
--
-- WHAT IT DOES. Seven columns, their CHECKs and comments, nothing else. All
-- numeric, not null, with a default, so the one existing row (id 1) takes the
-- default on every column -- no backfill.
--   mpf_rate          0.3464  CBP merchandise processing fee, percent of entered value
--   mpf_min           34.58   MPF floor per entry, USD
--   mpf_max           670.86  MPF ceiling per entry, USD
--   hmf_rate          0.125   harbor maintenance fee, percent of entered value
--   dis_rate          2.5     DIS, percent of MPF plus HMF plus duty (Kristy)
--   insurance_rate    0.4     cargo insurance, percent of the insured value
--   insurance_uplift  110     insured value as a percent of the landed value
-- ONE CHECK, kui_settings_landed_rates_check -- the four rates (mpf, hmf, dis,
-- insurance) between 0 and 100; the uplift between 100 and 200, as an insured
-- value below cost means nothing; the MPF floor and ceiling not negative, and
-- the floor no higher than the ceiling.
--
-- NO GRANT OR POLICY CHANGES. kui_settings_read is open to every signed-in user;
-- kui_settings_update is vessl.can_write_settings() (admin and staff). Table
-- grants cover columns added later, and the guard checks no column carries a
-- column-level grant. kui_settings has no triggers.
--
-- GUARDS, before any change.
--   none of the seven columns exists yet
--   exactly one row, id 1 (kui_settings_single_row)
--   no column of the table has a column-level grant
--
-- PROBES, each undone.
--   p1 As Jenn signed in through the app, setting mpf_min to 35 is accepted.
--   p2 As postgres, hmf_rate 101 is refused by the CHECK (23514).
--   p3 As postgres, mpf_min above mpf_max is refused by the CHECK (23514).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre133 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'kui_settings'
        and column_name in ('mpf_rate', 'mpf_min', 'mpf_max', 'hmf_rate', 'dis_rate', 'insurance_rate', 'insurance_uplift')) as n_cols,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.kui_settings'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*)::text || '/' || coalesce(string_agg(id::text, ','), '') from vessl.kui_settings) as rows_ids,
    -- The row, every column, so b4 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(k)::text, '/' order by k.id), ''))
       from vessl.kui_settings k)                                                                as h_rows;

do $guard$
begin
  if (select n_cols from _pre133) <> 0 then
    raise exception 'a landed-cost rate column already exists on kui_settings, nothing changed';
  end if;
  if (select rows_ids from _pre133) <> '1/1' then
    raise exception 'kui_settings is not the one row id 1, nothing changed';
  end if;
  if (select n_colacl from _pre133) <> 0 then
    raise exception 'a column of kui_settings has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
end
$guard$;

alter table vessl.kui_settings
  add column mpf_rate         numeric not null default 0.3464,
  add column mpf_min          numeric not null default 34.58,
  add column mpf_max          numeric not null default 670.86,
  add column hmf_rate         numeric not null default 0.125,
  add column dis_rate         numeric not null default 2.5,
  add column insurance_rate   numeric not null default 0.4,
  add column insurance_uplift numeric not null default 110;

alter table vessl.kui_settings
  add constraint kui_settings_landed_rates_check check (
        mpf_rate between 0 and 100 and hmf_rate between 0 and 100
    and dis_rate between 0 and 100 and insurance_rate between 0 and 100
    and insurance_uplift between 100 and 200
    and mpf_min >= 0 and mpf_max >= 0 and mpf_min <= mpf_max);

comment on column vessl.kui_settings.mpf_rate is 'Script 133. CBP merchandise processing fee, percent of the entered (CI) value. Landed-cost panel.';
comment on column vessl.kui_settings.mpf_min is 'Script 133. MPF floor per entry, USD. CBP resets it each fiscal year from 1 October.';
comment on column vessl.kui_settings.mpf_max is 'Script 133. MPF ceiling per entry, USD. CBP resets it each fiscal year from 1 October.';
comment on column vessl.kui_settings.hmf_rate is 'Script 133. Harbor maintenance fee, percent of the entered (CI) value.';
comment on column vessl.kui_settings.dis_rate is 'Script 133. DIS, percent of MPF plus HMF plus duty, per the freight sheet Kristy uses.';
comment on column vessl.kui_settings.insurance_rate is 'Script 133. Cargo insurance, percent of the insured value.';
comment on column vessl.kui_settings.insurance_uplift is 'Script 133. Insured value as a percent of CI plus freight plus fees and duty, usually 110.';

create temp table _probe133 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
begin
  -- p1, as a signed-in staff user -- mpf_min 35 on the one row.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.kui_settings set mpf_min = 35 where id = 1;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe133 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2 and p3, as postgres -- out of range refused.
  begin
    update vessl.kui_settings set hmf_rate = 101 where id = 1;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe133 values (2, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    update vessl.kui_settings set mpf_min = 700 where id = 1;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe133 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, kui_settings rows and ids = ' || (select rows_ids from _pre133) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 seven columns, numeric, not null, with defaults',
         (select count(*)::text || '/' || count(*) filter (where data_type = 'numeric' and is_nullable = 'NO' and column_default is not null)::text
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name in ('mpf_rate', 'mpf_min', 'mpf_max', 'hmf_rate', 'dis_rate', 'insurance_rate', 'insurance_uplift')),
         '7/7'::text
  union all
  select 'b2 the row reads the seven defaults',
         (select mpf_rate::text || '/' || mpf_min::text || '/' || mpf_max::text || '/' || hmf_rate::text || '/'
                 || dis_rate::text || '/' || insurance_rate::text || '/' || insurance_uplift::text
            from vessl.kui_settings where id = 1),
         '0.3464/34.58/670.86/0.125/2.5/0.4/110'::text
  union all
  select 'b3 the CHECK exists and is validated, seven comments',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') from pg_constraint
           where conrelid = 'vessl.kui_settings'::regclass and conname = 'kui_settings_landed_rates_check')
           || '/' || (select count(*)::text from pg_attribute
                       where attrelid = 'vessl.kui_settings'::regclass
                         and attname in ('mpf_rate', 'mpf_min', 'mpf_max', 'hmf_rate', 'dis_rate', 'insurance_rate', 'insurance_uplift')
                         and col_description(attrelid, attnum) like 'Script 133.%'),
         '1/true/7'::text
  union all
  select 'b4 every existing column on the row unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(k) - 'mpf_rate' - 'mpf_min' - 'mpf_max' - 'hmf_rate'
                                                   - 'dis_rate' - 'insurance_rate' - 'insurance_uplift')::text, '/' order by k.id), ''))
                           = (select h_rows from _pre133) then 'same' else 'changed' end
            from vessl.kui_settings k),
         'same'::text
  union all
  select 'b5 probes -- staff sets mpf_min; hmf 101 and min above max refused',
         (select string_agg(result, ' | ' order by step) from _probe133),
         'allowed 1 | 23514 | 23514'::text
  union all
  select 'b6 still no column-level grants, still one row',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.kui_settings'::regclass
             and attnum > 0 and not attisdropped and attacl is not null)
           || '/' || (select count(*)::text from vessl.kui_settings),
         '0/1'::text
  union all
  select 'z0 verification ran, mpf min and max = '
           || (select mpf_min::text || ' and ' || mpf_max::text from vessl.kui_settings where id = 1),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
