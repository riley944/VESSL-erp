-- 136r -- Reverse of 136. Companies and products without kui_ior.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- once the Testing and Samples selects name kui_ior,
-- they fail as soon as the column is gone.
--
-- WHAT IT DOES. Drops companies.kui_ior and products.kui_ior, losing whatever
-- flags were set (a0 counts them). products.importer_of_record is not touched.
-- No other column, no other row.
--
-- GUARDS, before any change.
--   both kui_ior columns exist (136 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name in ('companies', 'products')
         and column_name = 'kui_ior') <> 2 then
    raise exception 'the two kui_ior columns are not both there, so 136 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre136r on commit drop as
  select
    (select count(kui_ior) from vessl.companies)                                                 as n_set_co,
    (select count(kui_ior) from vessl.products)                                                  as n_set_prod,
    (select count(*) from vessl.companies)                                                       as n_co,
    (select count(*) from vessl.products)                                                        as n_prod,
    -- Every row, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(c) - 'kui_ior')::text, '/' order by c.id), ''))
       from vessl.companies c)                                                                   as h_co,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'kui_ior')::text, '/' order by p.id), ''))
       from vessl.products p)                                                                    as h_prod;

alter table vessl.companies drop column kui_ior;
alter table vessl.products  drop column kui_ior;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, flags lost companies/products = '
           || (select n_set_co::text || '/' || n_set_prod::text from _pre136r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 both kui_ior columns are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name in ('companies', 'products')
             and column_name = 'kui_ior'),
         '0'::text
  union all
  select 'b2 every other company column unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(c)::text, '/' order by c.id), ''))
                           = (select h_co from _pre136r) then 'same' else 'changed' end
            from vessl.companies c),
         'same'::text
  union all
  select 'b3 every other product column unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), ''))
                           = (select h_prod from _pre136r) then 'same' else 'changed' end
            from vessl.products p),
         'same'::text
  union all
  select 'b4 same number of rows, companies/products',
         (select count(*)::text from vessl.companies) || '/' || (select count(*)::text from vessl.products),
         (select n_co::text || '/' || n_prod::text from _pre136r)
  union all
  select 'z0 verification ran, companies/products = '
           || (select count(*)::text from vessl.companies) || '/' || (select count(*)::text from vessl.products),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
