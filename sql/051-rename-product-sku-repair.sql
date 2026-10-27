-- 51 -- rename_product_sku, repaired. It has been broken since script 48.
--
-- EVERY SKU RENAME CURRENTLY FAILS, whatever SKU it starts from. Not some -- all
-- of them. Nobody has renamed one since 48, which is the only reason this has
-- gone unnoticed for a day.
--
-- ── WHAT BROKE ──────────────────────────────────────────────────────────────
-- The function reads vessl.programs.sku and vessl.programs.quote_sku in three
-- statements. Script 48 renamed the old programs table to programs_legacy and
-- put a product-by-client table in its place, and the new one has neither
-- column. Proven directly rather than reasoned about --
--
--   select 1 from vessl.programs x where x.sku = a literal;
--   ERROR 42703: column x.sku does not exist
--
-- plpgsql plans a statement when it first EXECUTES it, and all three execute
-- even when p_program_ids arrives empty -- an empty unnest yields no rows, but
-- the planner still has to resolve the columns. So the failure is total.
--
-- It lands at APPLY, not at open. Step 1 removed the client-side programs query
-- from the modal, so the checklist loads perfectly and the failure arrives after
-- somebody has ticked their boxes.
--
-- ── THE THREE STATEMENTS, REMOVED ───────────────────────────────────────────
--   the p_program_ids ownership guard
--   the return query writing programs.sku
--   the return query writing programs.quote_sku
--
-- Everything else is byte-identical to what is live. This is a repair, not a
-- rewrite, and the diff should be readable as three deletions.
--
-- ── p_program_ids STAYS IN THE SIGNATURE, IGNORED ───────────────────────────
-- app/components/RenameSkuModal.jsx line 116 is the ONLY call site in the repo --
-- grepped, and the only other rpc anywhere in the app is rfq_digest_rows. It
-- still passes p_program_ids, always as an empty array, because step 1 set its
-- source list to a constant empty.
--
-- Dropping the parameter would break that call outright. PostgREST resolves a
-- function by ARGUMENT NAMES, so a call carrying an argument the signature does
-- not have fails with could-not-find-the-function. Keeping both signatures would
-- create an overload and make the call ambiguous instead.
--
-- So it is accepted and ignored. VESTIGIAL, and it should be dropped together
-- with the client in one later change rather than either one alone.
--
-- ── AND THE GRANT IS TIGHTENED ──────────────────────────────────────────────
-- CREATE FUNCTION grants EXECUTE to PUBLIC, and anon inherits PUBLIC. Script 21
-- found this same default on the digest function. Here the exposure is smaller --
-- this function is NOT security definer, so it runs as the caller and RLS still
-- applies, meaning anon can reach it but cannot change anything through it.
--
-- Smaller is not zero, and CREATE OR REPLACE PRESERVES existing grants, so the
-- revoke has to be explicit or the default simply survives the repair.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- One overload. Not security definer. search_path pinned to vessl, pg_catalog.
-- EXECUTE currently held by PUBLIC, so both authenticated and anon can call it.
-- program_stage_touch, which an old comment in the body names, now sits on
-- programs_legacy. Rehearsal z0, commit z0.

begin;

create temp table _pre51 on commit drop as
  select (select count(*) from pg_proc where proname = 'rename_product_sku')         as overloads_before,
         (select position('vessl.programs x' in pg_get_functiondef(oid))
            from pg_proc where proname = 'rename_product_sku')                       as guard_before,
         (select position('programs g set sku' in pg_get_functiondef(oid))
            from pg_proc where proname = 'rename_product_sku')                       as setsku_before,
         (select position('programs g set quote_sku' in pg_get_functiondef(oid))
            from pg_proc where proname = 'rename_product_sku')                       as setqsku_before,
         (select pronargs from pg_proc where proname = 'rename_product_sku')         as nargs_before,
         (select has_function_privilege('anon','vessl.rename_product_sku(uuid,text,text,uuid[],uuid[],uuid[],uuid[],text)','execute'))
                                                                                     as anon_before;

create or replace function vessl.rename_product_sku(
  p_product_id uuid,
  p_expected_old_sku text,
  p_new_sku text,
  p_quote_ids uuid[] default '{}'::uuid[],
  p_poi_ids uuid[] default '{}'::uuid[],
  p_soi_ids uuid[] default '{}'::uuid[],
  -- VESTIGIAL. Accepted so the existing client call keeps resolving, ignored
  -- because the table it addressed no longer has the columns. Drop it and the
  -- client argument together, never one alone.
  p_program_ids uuid[] default '{}'::uuid[],
  p_updated_by text default null)
returns table(target_table text, row_id uuid, column_name text, old_value text, new_value text, changed boolean)
language plpgsql
set search_path to 'vessl', 'pg_catalog'
as $function$
declare
  v_old_sku text;
  v_name    text;
  v_old_key text;
  v_bad     uuid;
  v_new     text := btrim(coalesce(p_new_sku,''));
begin
  if v_new = '' then
    raise exception 'rename_product_sku: the new SKU is blank. Nothing changed.';
  end if;

  -- Lock the product FIRST. Two people renaming the same product from two tabs
  -- must not both pass the guard below; the second waits here and then fails.
  select p.sku, p.name into v_old_sku, v_name
    from vessl.products p where p.id = p_product_id for update;

  if not found then
    raise exception 'rename_product_sku: no product with id %. Nothing changed.',
      p_product_id;
  end if;

  -- THE GUARD. is distinct from, so a NULL on either side is a mismatch rather
  -- than a silent pass. That is also what lets a product with NO sku be named
  -- for the first time -- null expected against null actual passes.
  if v_old_sku is distinct from p_expected_old_sku then
    raise exception
      'rename_product_sku: product % now reads SKU "%" but the caller expected "%". '
      'Someone changed it in the meantime. Nothing changed -- reopen and try again.',
      p_product_id, coalesce(v_old_sku,'(null)'), coalesce(p_expected_old_sku,'(null)');
  end if;

  v_old_key := case when btrim(coalesce(v_name,'')) = '' then null
                    else btrim(coalesce(v_old_sku,''))||'|'||btrim(v_name) end;

  -- ── OWNERSHIP: every id must belong to THIS product. A caller sending an id
  -- that does not is a bug, so this raises rather than skipping the row.
  select i into v_bad from unnest(p_poi_ids) i
   where not exists (select 1 from vessl.purchase_order_items x
                      where x.id = i and x.product_id = p_product_id) limit 1;
  if v_bad is not null then
    raise exception 'rename_product_sku: PO line % does not belong to product %. Nothing changed.',
      v_bad, p_product_id;
  end if;

  -- A quote qualifies by the NEW link, or by the OLD key for unlinked rows.
  select i into v_bad from unnest(p_quote_ids) i
   where not exists (select 1 from vessl.quotes x
                      where x.id = i
                        and (x.product_id = p_product_id
                             or (v_old_key is not null
                                 and btrim(coalesce(x.sku,''))||'|'||btrim(coalesce(x.product,''))
                                   = v_old_key))) limit 1;
  if v_bad is not null then
    raise exception 'rename_product_sku: quote % is neither linked to product % nor matches its old key. Nothing changed.',
      v_bad, p_product_id;
  end if;

  -- THE PROGRAM OWNERSHIP GUARD WAS HERE. Removed by script 51 -- it read the
  -- sku and quote_sku columns of the old programs table, and script 48 replaced
  -- that table with one keyed on product and client that carries neither. A
  -- program is now found through product_id, so a SKU rename cannot strand one
  -- and there is nothing here to fix up.
  --
  -- This comment deliberately avoids the schema-qualified table name, because
  -- b1 below searches the whole definition for it and a comment would satisfy
  -- that search as readily as code. Naming the legacy table would too -- the
  -- qualified name is a prefix of it.

  -- SO lines have NO product_id anywhere in the table (0 of 254), so the only
  -- possible check is the string itself. client_sku is a MIXED column -- mostly
  -- our SKU, sometimes the customer own code (BGTEE1, BGLHAC-INTNEW) -- which
  -- is why the modal never pre-ticks these.
  select i into v_bad from unnest(p_soi_ids) i
   where not exists (select 1 from vessl.sales_order_items x
                      where x.id = i and x.client_sku = v_old_sku) limit 1;
  if v_bad is not null then
    raise exception 'rename_product_sku: SO line % does not carry client_sku "%". Nothing changed.',
      v_bad, coalesce(v_old_sku,'(null)');
  end if;

  -- ── THE PRODUCT. products_sku_name_key is UNIQUE (sku, name), so renaming
  -- into a pair another row already holds raises 23505. Caught and re-raised as
  -- something a human can act on.
  begin
    return query
      update vessl.products p
         set sku = v_new, updated_at = now()   -- no trigger on this table; by hand
       where p.id = p_product_id
      returning 'products'::text, p.id, 'sku'::text,
                v_old_sku, v_new, (v_old_sku is distinct from v_new);
  exception when unique_violation then
    raise exception
      'rename_product_sku: cannot rename to "%" -- another product already holds that '
      'SKU with the name "%" (products_sku_name_key). Nothing changed.', v_new, v_name;
  end;

  -- ── QUOTES. Old values come from a CTE rather than RETURNING: PostgreSQL 17
  -- has no OLD in RETURNING, and both arms of one statement see one snapshot.
  -- updated_by is coalesced so a caller that passes nothing leaves the existing
  -- author alone rather than blanking it. quotes is the only table touched here
  -- that has the column at all.
  return query
    with before as (select id, sku from vessl.quotes where id = any(p_quote_ids)),
         upd as (update vessl.quotes q
                    set sku = v_new,
                        updated_at = now(),
                        updated_by = coalesce(p_updated_by, q.updated_by)
                  where q.id = any(p_quote_ids) returning q.id)
    select 'quotes'::text, b.id, 'sku'::text, b.sku, v_new, (b.sku is distinct from v_new)
      from before b join upd u on u.id = b.id;

  -- ── PO LINES. Writing product_sku does NOT fire trg_poi_stamp_product_sku:
  -- that trigger is UPDATE OF product_id, and this statement never names that
  -- column. Script 16 stops SILENT rewrites; a ticked box is not silent.
  return query
    with before as (select id, product_sku from vessl.purchase_order_items where id = any(p_poi_ids)),
         upd as (update vessl.purchase_order_items i set product_sku = v_new
                  where i.id = any(p_poi_ids) returning i.id)
    select 'purchase_order_items'::text, b.id, 'product_sku'::text,
           b.product_sku, v_new, (b.product_sku is distinct from v_new)
      from before b join upd u on u.id = b.id;

  -- ── SO LINES. Only ever what was explicitly ticked.
  return query
    with before as (select id, client_sku from vessl.sales_order_items where id = any(p_soi_ids)),
         upd as (update vessl.sales_order_items i set client_sku = v_new
                  where i.id = any(p_soi_ids) returning i.id)
    select 'sales_order_items'::text, b.id, 'client_sku'::text,
           b.client_sku, v_new, (b.client_sku is distinct from v_new)
      from before b join upd u on u.id = b.id;

  -- THE TWO PROGRAM RETURN QUERIES WERE HERE, writing programs.sku and
  -- programs.quote_sku. Removed by script 51 for the same reason as the guard.
  -- The old comment beside them named trigger program_stage_touch, which now
  -- sits on programs_legacy along with the table it was written for.

  return;
end;
$function$;

-- CREATE OR REPLACE PRESERVES GRANTS, so the PUBLIC default survives a repair
-- unless it is taken away by hand. anon inherits PUBLIC.
revoke all on function vessl.rename_product_sku(uuid,text,text,uuid[],uuid[],uuid[],uuid[],text) from public;
grant execute on function vessl.rename_product_sku(uuid,text,text,uuid[],uuid[],uuid[],uuid[],text) to authenticated;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  -- THE BREAKAGE, PROVEN PRESENT BEFORE IT IS REMOVED. If these read 0 the
  -- function had already been repaired and this script is not the fix it claims.
  select 'a0 the program ownership guard was there' as chk,
         (select (guard_before > 0)::text from _pre51) as got, 'true' as want
  union all
  select 'a1 and both program writes were there',
         (select ((setsku_before > 0) and (setqsku_before > 0))::text from _pre51), 'true'
  union all
  select 'a2 exactly one overload existed',
         (select overloads_before::text from _pre51), '1'
  union all
  select 'a3 and anon could execute it',
         (select anon_before::text from _pre51), 'true'
  union all
  -- THE REPAIR. No reference to the programs table survives anywhere in the body.
  select 'b1 nothing in the body mentions the programs table',
         (select (position('vessl.programs' in pg_get_functiondef(oid)) = 0)::text
            from pg_proc where proname = 'rename_product_sku'), 'true'
  union all
  select 'b2 nor writes programs.sku or programs.quote_sku',
         (select ((position('programs g set sku' in pg_get_functiondef(oid)) = 0)
              and (position('programs g set quote_sku' in pg_get_functiondef(oid)) = 0))::text
            from pg_proc where proname = 'rename_product_sku'), 'true'
  union all
  -- THE SIGNATURE IS UNTOUCHED, which is what keeps the existing client call
  -- resolving. Eight arguments, one overload, same argument names in order.
  select 'b3 still eight arguments and one overload',
         (select count(*)::text || ' of ' || max(pronargs)::text
            from pg_proc where proname = 'rename_product_sku'), '1 of 8'
  union all
  -- The catalogue renders NAMES with types here, not types alone. The first
  -- version of this check wanted a types-only list and failed on a function that
  -- was perfectly correct.
  select 'b4 p_program_ids is still accepted, in position seven',
         (select (pg_get_function_identity_arguments(oid))::text
            from pg_proc where proname = 'rename_product_sku'),
         'p_product_id uuid, p_expected_old_sku text, p_new_sku text, p_quote_ids uuid[], p_poi_ids uuid[], p_soi_ids uuid[], p_program_ids uuid[], p_updated_by text'
  union all
  select 'b7 and nothing unnests it, so it is read nowhere',
         (select (position('unnest(p_program_ids)' in pg_get_functiondef(oid)) = 0)::text
            from pg_proc where proname = 'rename_product_sku'), 'true'
  union all
  select 'b5 the other guards survived, PO lines quotes and SO lines',
         (select ((position('does not belong to product' in pg_get_functiondef(oid)) > 0)
              and (position('nor matches its old key' in pg_get_functiondef(oid)) > 0)
              and (position('does not carry client_sku' in pg_get_functiondef(oid)) > 0))::text
            from pg_proc where proname = 'rename_product_sku'), 'true'
  union all
  select 'b6 and so did the null-tolerant expected-sku guard',
         (select (position('v_old_sku is distinct from p_expected_old_sku' in pg_get_functiondef(oid)) > 0)::text
            from pg_proc where proname = 'rename_product_sku'), 'true'
  union all
  select 'c1 it is still not security definer, so RLS still applies',
         (select prosecdef::text from pg_proc where proname = 'rename_product_sku'), 'false'
  union all
  select 'c2 with its search_path still pinned',
         (select (p.proconfig is not null)::text from pg_proc p where p.proname = 'rename_product_sku'), 'true'
  union all
  select 'd1 anon can no longer execute it',
         (select has_function_privilege('anon','vessl.rename_product_sku(uuid,text,text,uuid[],uuid[],uuid[],uuid[],text)','execute')::text), 'false'
  union all
  select 'd2 but authenticated still can, which is the modal',
         (select has_function_privilege('authenticated','vessl.rename_product_sku(uuid,text,text,uuid[],uuid[],uuid[],uuid[],text)','execute')::text), 'true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
