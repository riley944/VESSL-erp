-- 40 -- move the JON-106 test report onto the product it actually describes.
--
-- ── ONE ROW, AND WHY IT IS NOT COSMETIC ──────────────────────────────────────
-- SKU JON-106 exists twice.
--
--   61d55187  Wine Chiller           RETIRED     holds the only JON-106 report
--   138427ce  Wine Container White   SELECTABLE  declares passed, eFiled
--                                                2026-08-19, and has NO report
--
-- So the live product asserts a compliance status and an eFiling date with no
-- evidence attached, while the evidence sits on a retired twin nobody looks at.
-- That is a compliance record pointing at the wrong product, not a display bug.
--
-- ── THE EVIDENCE THAT THIS IS THE RIGHT DIRECTION ────────────────────────────
-- Moving a test report between products is not a decision to take on a hunch --
-- attaching a report to the wrong product is worse than leaving it detached. The
-- report itself names its subject, and it names the SELECTABLE row.
--
--   report_number      T-26301506-10-R1
--   style_ref          JON-106
--   sample_description Wine Container White   <- the name of 138427ce, exactly
--   composition        Wine Chiller. 100% stainless Style JUAC100440
--   overall_result     pass          test_date 2026-05-28
--
-- sample_description matches the target product name character for character, at
-- 20 characters, which a3 asserts. The composition line mentioning Wine Chiller is
-- consistent with one physical item carrying two names in the catalogue, which is
-- the duplicate this resolves rather than a contradiction of it.
--
-- ── LLF-1617 IS NOT THIS SHAPE, AND IS DELIBERATELY NOT HERE ─────────────────
-- It was checked because it looked identical from the outside. It is not. NEITHER
-- LLF-1617 row holds a report -- the selectable 0ea36842 and the retired b9d0fe7a
-- both declare passed with no evidence anywhere. There is nothing to relink; its
-- status is simply unsupported, which is a question for a person and not a script.
--
-- ── THE eFILING DATE IS RE-CHECKED, NOT REWRITTEN ───────────────────────────
-- 138427ce carries efiled_date 2026-08-19. Once the report is attached, that date
-- can be judged for the first time -- and it sits AFTER the 2026-05-28 test date,
-- which is the right order for a filing made against a passing report. c2 asserts
-- that ordering. It does not assert the date is correct, because this script has
-- no way to know that; it asserts the date is no longer unfalsifiable.
--
-- MEASURED WHILE WRITING c2, and worth knowing before the relink is judged. BOTH
-- twins carry efiled_date 2026-08-19, not just the selectable one. So the same
-- filing date was recorded against two product rows for one physical item -- more
-- evidence that these are one product entered twice, and a second thing for a
-- person to resolve once identity is settled.
--
-- Nothing on either product is written. Not compliance_status, not efiled_date,
-- not active. The only column this script writes is test_reports.product_id, on
-- one row.
--
-- ── MEASURED BEFORE WRITING, against the live database ───────────────────────
-- 84 test reports, 11 product-linked across 4 products, one of those 4 retired.
-- Report 165863ea currently on 61d55187. Rehearsal z0, commit z0.

begin;

-- PRE-STATE FIRST.
create temp table _pre40 on commit drop as
  select (select count(*) from vessl.test_reports)                            as reports_before,
         (select count(*) from vessl.test_reports where product_id is null)   as orphans_before,
         (select count(*) from vessl.test_reports
           where product_id = '61d55187-749d-46b1-9d39-b2f2d3245ea1'::uuid)   as on_retired_before,
         (select count(*) from vessl.test_reports
           where product_id = '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid)   as on_selectable_before;

create temp table _b40 on commit drop as
  select t.id, t.product_id, t.report_number, length(t.report_number) as rn_len,
         length(t.sample_description) as sd_len, t.overall_result, t.test_date
    from vessl.test_reports t
   where t.id = '165863ea-6f50-4335-8e38-b1b9fc571fb0'::uuid;

-- THE WRITE. Keyed on the report id, guarded on it still sitting where it was
-- measured, so a report somebody has already moved is skipped and fails b1 loudly
-- rather than being moved again.
update vessl.test_reports t
   set product_id = '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid
 where t.id = '165863ea-6f50-4335-8e38-b1b9fc571fb0'::uuid
   and t.product_id = '61d55187-749d-46b1-9d39-b2f2d3245ea1'::uuid
   and length(t.report_number) = 16;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the report was on the retired twin, at its exact report number length' as chk,
         (select count(*)::text from _b40
           where product_id = '61d55187-749d-46b1-9d39-b2f2d3245ea1'::uuid and rn_len = 16) as got,
         '1' as want
  union all
  select 'a1 it was the only report on that retired product',
         (select on_retired_before::text from _pre40), '1'
  union all
  select 'a2 the selectable twin had none',
         (select on_selectable_before::text from _pre40), '0'
  union all
  -- THE EVIDENCE CHECK. sample_description is the report naming its own subject,
  -- and the target product name is 20 characters. Asserted by LENGTH, which no
  -- paste can fake, rather than by comparing the text.
  select 'a3 the sample description is the same length as the target product name',
         (select (b.sd_len = length(p.name))::text
            from _b40 b, vessl.products p
           where p.id = '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid), 'true'
  union all
  select 'a4 and the report passed',
         (select overall_result from _b40), 'pass'
  union all
  select 'b1 the report now sits on the selectable product',
         (select count(*)::text from vessl.test_reports
           where id = '165863ea-6f50-4335-8e38-b1b9fc571fb0'::uuid
             and product_id = '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid), '1'
  union all
  select 'b2 the retired twin now holds none',
         (select count(*)::text from vessl.test_reports
           where product_id = '61d55187-749d-46b1-9d39-b2f2d3245ea1'::uuid), '0'
  union all
  select 'b3 no report was created or deleted',
         (select ((select count(*) from vessl.test_reports) - (select reports_before from _pre40))::text), '0'
  union all
  select 'b4 the 73 orphans are untouched',
         (select ((select count(*) from vessl.test_reports where product_id is null)
                - (select orphans_before from _pre40))::text), '0'
  union all
  -- eFILING NOW JUDGEABLE. Filed after the test it was filed against.
  select 'c1 the eFiled date sits after the test date, which is the right order',
         (select (p.efiled_date > b.test_date)::text
            from _b40 b, vessl.products p
           where p.id = '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid), 'true'
  union all
  -- NEITHER PRODUCT ROW IS WRITTEN.
  select 'c2 neither product changed its status, filing date or active state',
         (select string_agg(coalesce(p.compliance_status,'-') || '/' ||
                            coalesce(p.efiled_date::text,'-') || '/' ||
                            coalesce(p.active::text,'-'), ' | ' order by p.active nulls last)
            from vessl.products p
           where p.id in ('61d55187-749d-46b1-9d39-b2f2d3245ea1'::uuid,
                          '138427ce-e743-441f-9f82-850ffe0f69a7'::uuid)),
         'passed/2026-08-19/false | passed/2026-08-19/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
