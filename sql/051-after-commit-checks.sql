-- 51 after-commit checks. Run AFTER 51 commits, as a separate statement.
--
-- Everything here rolls back, so it can be run twice.
--
-- WHY THESE ARE NOT IN 51 ITSELF. Script 51 proves the function no longer
-- MENTIONS the programs table. That is a text search over the definition, and a
-- text search cannot tell you the function still works -- it could just as
-- easily have been broken in some new way by the same edit.
--
-- THE ONLY PROOF IS A RENAME THAT ACTUALLY HAPPENS, THROUGH THE FUNCTION.
-- Not a raw UPDATE that would pass whether or not the function is sound. So this
-- creates a throwaway product, renames it by calling vessl.rename_product_sku,
-- checks both what the function REPORTED and what the table now HOLDS, then
-- deletes the row and checks it is gone.
--
-- BELT AND BRACES ON THE CLEANUP. The delete is exercised explicitly, because
-- that is the step being asked for, AND the whole transaction rolls back. So
-- even a check failing halfway leaves nothing behind -- a ZZTEST product
-- stranded in a 184-row catalogue would be a small mess in a place that has
-- spent a week getting identity right.
--
-- ── MEASURED BEFORE WRITING ─────────────────────────────────────────────────
-- 0 products carry a ZZTEST name or sku today, so the namespace is clean and
-- a0 asserts that rather than assuming it. products carries no trigger, so an
-- insert here sets exactly what it says.

begin;

create temp table _pre51b on commit drop as
  select (select count(*) from vessl.products)                                as rows_before,
         (select count(*) from vessl.products
           where name like 'ZZTEST%' or sku like 'ZZTEST%')                   as zz_before;

-- 1. THE THROWAWAY.
create temp table _zz51 (id uuid) on commit drop;
with ins as (
  insert into vessl.products (sku, name, active)
  values ('ZZTEST-OLD-51', 'ZZTEST rename probe 51', true)
  returning id)
insert into _zz51 select id from ins;

-- 2. THE RENAME, THROUGH THE FUNCTION. p_program_ids is left at its default to
--    prove the vestigial parameter is harmless; the guard that used to read it
--    is what script 51 removed.
create temp table _rpc51 on commit drop as
  select * from vessl.rename_product_sku(
    (select id from _zz51),
    'ZZTEST-OLD-51',
    'ZZTEST-NEW-51');

-- 3. WHAT THE TABLE HOLDS, captured before the delete takes the row away.
create temp table _after51 on commit drop as
  select id, sku, name from vessl.products where id = (select id from _zz51);

-- 4. THE CLEANUP, exercised rather than left to the rollback.
delete from vessl.products where id = (select id from _zz51);

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 no ZZTEST row existed before this ran' as chk,
         (select zz_before::text from _pre51b) as got, '0' as want
  union all
  -- THE FUNCTION RETURNED, which alone is more than it could do before 51 --
  -- every call used to fail at plan time on a column that no longer exists.
  select 'a1 the function returned a report at all',
         (select (count(*) > 0)::text from _rpc51), 'true'
  union all
  select 'a2 and it reported the product row it changed',
         (select count(*)::text from _rpc51
           where target_table = 'products' and column_name = 'sku'), '1'
  union all
  select 'a3 naming the old value and the new one',
         (select old_value::text || ' to ' || new_value::text from _rpc51
           where target_table = 'products'), 'ZZTEST-OLD-51 to ZZTEST-NEW-51'
  union all
  select 'a4 and marking it changed',
         (select changed::text from _rpc51 where target_table = 'products'), 'true'
  union all
  -- WHAT THE FUNCTION SAID AND WHAT THE TABLE DID, checked separately. A report
  -- that claims a change nobody made is the failure this pair catches.
  select 'b1 the product itself now reads the new sku',
         (select sku::text from _after51), 'ZZTEST-NEW-51'
  union all
  select 'b2 and its name was left alone',
         (select name::text from _after51), 'ZZTEST rename probe 51'
  union all
  select 'b3 nothing else was reported, since nothing else was ticked',
         (select count(*)::text from _rpc51 where target_table is distinct from 'products'), '0'
  union all
  -- THE CLEANUP.
  select 'c1 the throwaway row is gone',
         (select count(*)::text from vessl.products where id = (select id from _zz51)), '0'
  union all
  select 'c2 and no ZZTEST row survives anywhere',
         (select count(*)::text from vessl.products
           where name like 'ZZTEST%' or sku like 'ZZTEST%'), '0'
  union all
  select 'c3 the catalogue is exactly the size it was',
         (select ((select count(*) from vessl.products) - (select rows_before from _pre51b))::text), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- Nothing here persists. The row was created to be renamed and deleted, and the
-- rollback is the second guarantee that neither survives.
rollback;
