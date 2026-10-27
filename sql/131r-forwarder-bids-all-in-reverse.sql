-- 131r -- Reverse of 131. forwarder_bids without all_in.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CODE OUT FIRST -- Add bid by hand, the sheet import, the bid card and
-- Apply bid read or write all_in and fail once it is gone.
--
-- WHAT IT DOES. Drops the all_in column, losing which bids were marked all-in
-- (a0 counts them). Their totals stay in effective_per_container and rates, so
-- an all-in FCL bid then reads as an ordinary bid with no breakdown. No other
-- column, no other row.
--
-- GUARDS, before any change.
--   all_in exists (131 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the count before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

do $guard$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'vessl' and table_name = 'forwarder_bids' and column_name = 'all_in') <> 1 then
    raise exception 'forwarder_bids.all_in does not exist, so 131 was not committed, nothing changed';
  end if;
end
$guard$;

create temp table _pre131r on commit drop as
  select
    (select count(*) from vessl.forwarder_bids)                                                  as n_bids,
    (select count(*) from vessl.forwarder_bids where all_in)                                     as n_allin,
    -- Every bid, every column but the one dropped.
    (select md5(coalesce(string_agg((to_jsonb(b) - 'all_in')::text, '/' order by b.id), ''))
       from vessl.forwarder_bids b)                                                              as h_rest;

alter table vessl.forwarder_bids drop column all_in;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, forwarder bids = ' || (select n_bids::text from _pre131r)
           || ', marked all-in and lost = ' || (select n_allin::text from _pre131r) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the column is gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'forwarder_bids' and column_name = 'all_in'),
         '0'::text
  union all
  select 'b2 every bid unchanged apart from the column dropped',
         (select case when md5(coalesce(string_agg(to_jsonb(b)::text, '/' order by b.id), ''))
                           = (select h_rest from _pre131r) then 'same' else 'changed' end
            from vessl.forwarder_bids b),
         'same'::text
  union all
  select 'b3 same number of bids',
         (select count(*)::text from vessl.forwarder_bids), (select n_bids::text from _pre131r)
  union all
  select 'z0 verification ran, forwarder bids = ' || (select count(*)::text from vessl.forwarder_bids),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
