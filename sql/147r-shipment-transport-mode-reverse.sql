-- 147r -- Reverse of 147. Drops shipments.transport_mode.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- Take the round 7 code out first -- it writes the column on New Shipment and
-- on the card.
--
-- WHAT IT DOES. Drops the CHECK shipments_transport_mode and the column. Every
-- air or courier mode set since 147 is lost -- a0 counts them. No other column
-- or row changes.
--
-- GUARDS, before any change.
--   147 is committed -- the column and its CHECK exist
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre147r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'transport_mode')      as n_col,
    (select count(*) from pg_constraint where conname = 'shipments_transport_mode')                         as n_check,
    (select count(*) from vessl.shipments)                                                                  as n_rows;

do $guard$
begin
  if (select n_col from _pre147r) <> 1 or (select n_check from _pre147r) <> 1 then
    raise exception '147 is not committed, nothing changed';
  end if;
end
$guard$;

create temp table _lost147r on commit drop as
  select count(*) filter (where transport_mode <> 'ocean') as n_other,
         coalesce(string_agg(shipment_number || ' ' || transport_mode, ', ' order by shipment_number)
                  filter (where transport_mode <> 'ocean'), 'none') as which
    from vessl.shipments;

create temp table _h147r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(s) - 'transport_mode')::text, '/' order by s.id), '')) as h_rows
    from vessl.shipments s;

alter table vessl.shipments drop constraint shipments_transport_mode;
alter table vessl.shipments drop column transport_mode;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, modes other than ocean lost = ' || (select n_other::text || ' (' || which || ')' from _lost147r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 column and CHECK gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'shipments' and column_name = 'transport_mode')
         || '/' || (select count(*)::text from pg_constraint where conname = 'shipments_transport_mode'),
         '0/0'::text
  union all
  select 'b2 every other column of every row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), '')) = (select h_rows from _h147r)
                      then 'same' else 'changed' end from vessl.shipments s)
         || '/' || (select count(*)::text from vessl.shipments),
         'same/' || (select n_rows::text from _pre147r)
  union all
  select 'z0 verification ran',
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
