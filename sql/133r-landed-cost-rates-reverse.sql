-- 133r -- Reverse of 133. kui_settings without the landed-cost rates.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- Settings and the bid comparison read or write these
-- columns and fail once they are gone.
--
-- WHAT IT DOES. Drops kui_settings_landed_rates_check and the seven columns
-- mpf_rate, mpf_min, mpf_max, hmf_rate, dis_rate, insurance_rate and
-- insurance_uplift, losing whatever rates were saved (a0 shows them). No other
-- column, no other row.
--
-- GUARDS, before any change.
--   all seven columns exist (133 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'kui_settings'
         and column_name in ('mpf_rate', 'mpf_min', 'mpf_max', 'hmf_rate', 'dis_rate', 'insurance_rate', 'insurance_uplift')) <> 7 then
    raise exception 'the seven rate columns are not all there, so 133 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre133r on commit drop as
  select
    (select mpf_rate::text || '/' || mpf_min::text || '/' || mpf_max::text || '/' || hmf_rate::text || '/'
            || dis_rate::text || '/' || insurance_rate::text || '/' || insurance_uplift::text
       from vessl.kui_settings where id = 1)                                                     as rates,
    (select count(*) from vessl.kui_settings)                                                    as n_rows,
    -- The row, every column but the seven dropped.
    (select md5(coalesce(string_agg((to_jsonb(k) - 'mpf_rate' - 'mpf_min' - 'mpf_max' - 'hmf_rate'
                                     - 'dis_rate' - 'insurance_rate' - 'insurance_uplift')::text, '/' order by k.id), ''))
       from vessl.kui_settings k)                                                                as h_rest;

alter table vessl.kui_settings drop constraint kui_settings_landed_rates_check;
alter table vessl.kui_settings
  drop column mpf_rate, drop column mpf_min, drop column mpf_max, drop column hmf_rate,
  drop column dis_rate, drop column insurance_rate, drop column insurance_uplift;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, rates lost = ' || coalesce((select rates from _pre133r), 'none') as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the seven columns and the CHECK are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'kui_settings'
             and column_name in ('mpf_rate', 'mpf_min', 'mpf_max', 'hmf_rate', 'dis_rate', 'insurance_rate', 'insurance_uplift'))
           || '/' || (select count(*)::text from pg_constraint
                       where conrelid = 'vessl.kui_settings'::regclass and conname = 'kui_settings_landed_rates_check'),
         '0/0'::text
  union all
  select 'b2 every other column unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(k)::text, '/' order by k.id), ''))
                           = (select h_rest from _pre133r) then 'same' else 'changed' end
            from vessl.kui_settings k),
         'same'::text
  union all
  select 'b3 same number of rows',
         (select count(*)::text from vessl.kui_settings), (select n_rows::text from _pre133r)
  union all
  select 'z0 verification ran, kui_settings rows = ' || (select count(*)::text from vessl.kui_settings),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
