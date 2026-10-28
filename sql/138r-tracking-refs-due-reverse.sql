-- 138r -- Reverse of 138. Drops vessl.tracking_refs_due().
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Rehearse as written (it
-- ends in rollback), then swap the last two lines and run again to commit.
-- TAKE THE CRON OUT FIRST -- GET /api/tracking/refresh calls this function and
-- fails once it is gone. Nothing else changes.
--
-- GUARDS, before any change.
--   tracking_refs_due exists (138 has been committed)
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

do $guard$
begin
  if to_regprocedure('vessl.tracking_refs_due()') is null then
    raise exception 'tracking_refs_due is not there, so 138 was not committed, nothing changed';
  end if;
end
$guard$;

drop function vessl.tracking_refs_due();

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, function present' as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 the function is gone',
         coalesce(to_regprocedure('vessl.tracking_refs_due()')::text, 'none'), 'none'::text
  union all
  select 'z0 verification ran', 'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
