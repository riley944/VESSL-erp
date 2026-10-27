-- 55 -- rename_product_sku without p_program_ids.
--
-- The parameter has been vestigial since script 51. Nothing in the body reads it,
-- and 5489968, live since 2026-09-15, stopped the Rename SKU modal sending it.
-- This drops the eight-argument function and creates the seven-argument one.
--
-- ── WHY DROP AND CREATE, NOT CREATE OR REPLACE ──────────────────────────────
-- CREATE OR REPLACE cannot remove a parameter. The new function is a new object,
-- and three things do not carry over from the old one, so each is re-applied
-- here explicitly.
--   GRANTS.   CREATE FUNCTION grants EXECUTE to PUBLIC, and anon inherits PUBLIC.
--             Revoked from public and granted to authenticated, as 51 left it.
--   COMMENT.  Re-applied verbatim, and c3 proves it by fingerprint.
--   SETTINGS. search_path re-pinned to vessl, pg_catalog. SECURITY INVOKER is
--             written out rather than left to the default it already was.
--
-- ── THE BODY IS BYTE-IDENTICAL ──────────────────────────────────────────────
-- Generated from the as-run script 51, whose body was fingerprinted against the
-- live one before this file was written -- md5 of both, line endings normalised,
-- match. b3 proves the same thing against the new function.
--
-- ── WHAT A CALLER SEES ──────────────────────────────────────────────────────
-- PostgREST resolves a function by argument names. The live app no longer sends
-- p_program_ids, and the old signature defaulted it, so the app worked against the
-- old function and works against the new one. A browser tab loaded before 5489968
-- still sends it and gets a 404 -- could not find the function in the schema cache
-- -- before Postgres is ever called. Nothing is written, and a reload fixes it. e1
-- proves the old call shape is now refused.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- One overload, eight arguments, five defaults. Not security definer. search_path
-- vessl, pg_catalog. EXECUTE held by postgres and authenticated only. Nothing
-- depends on it, no other function calls it, and the only call site in the repo is
-- RenameSkuModal. The body never names p_program_ids and, outside its comments,
-- never names the programs table. products carries no trigger, and no ZZTEST
-- product exists.
--
-- ── THE RENAME PROBE ────────────────────────────────────────────────────────
-- Text checks prove the definition, not that the function works. So a throwaway
-- ZZTEST product is created and renamed THROUGH THE FUNCTION, called by argument
-- name the way PostgREST calls it, inside a subtransaction that is then forced to
-- roll back. What it reported and what the row held are kept in plpgsql variables,
-- which survive that rollback. The product does not, even if this script commits.

begin;

create temp table _pre55 on commit drop as
  select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku') as overloads_before,
         (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku') as args_before,
         (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku') as body_md5_before,
         (select md5(obj_description(p.oid, 'pg_proc')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku') as comment_md5_before,
         (select count(*) from vessl.products) as products_before,
         (select count(*) from vessl.products
           where name like 'ZZTEST%' or sku like 'ZZTEST%') as zz_before;

drop function vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], uuid[], text);

create function vessl.rename_product_sku(
  p_product_id uuid,
  p_expected_old_sku text,
  p_new_sku text,
  p_quote_ids uuid[] default '{}'::uuid[],
  p_poi_ids uuid[] default '{}'::uuid[],
  p_soi_ids uuid[] default '{}'::uuid[],
  p_updated_by text default null)
returns table(target_table text, row_id uuid, column_name text, old_value text, new_value text, changed boolean)
language plpgsql
security invoker
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

-- A NEW FUNCTION STARTS WITH EXECUTE GRANTED TO PUBLIC. Taken back by hand.
revoke all on function vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], text) from public;
grant execute on function vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], text) to authenticated;

-- COMMENT ON TAKES A STRING LITERAL, NEVER AN EXPRESSION, so the chr(61)
-- concatenation cannot sit there -- the first rehearsal failed on exactly that,
-- with 42601 at the double pipe. The text is built here instead and handed to
-- EXECUTE, and format with %L quotes it as a literal. c3 still compares the
-- stored comment against the old one by fingerprint.
do $comment$
begin
  execute format('comment on function vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], text) is %L',
    'Renames products.sku and propagates it to EXPLICITLY LISTED references in one transaction, returning a row-by-row report including rows that were already correct (changed ' || chr(61) || ' false). Guards on p_expected_old_sku under a row lock, so a concurrent rename fails loudly instead of being overwritten. Every listed id must belong to the product or the call is refused whole. Refuses readably on products_sku_name_key. p_updated_by stamps quotes.updated_by when supplied and leaves it alone when null -- quotes is the only touched table with that column. SECURITY INVOKER: reads and writes as the caller. PO-line snapshots are only ever changed when passed in -- see script 16.');
end
$comment$;

-- ── The probes. Results land in a temp table; every write is undone. ───────
create temp table _probe55 (step text, value text) on commit drop;

-- THE OLD CALL SHAPE, naming the dropped parameter, must no longer resolve.
do $oldcall$
begin
  begin
    perform * from vessl.rename_product_sku(
      p_product_id       => gen_random_uuid(),
      p_expected_old_sku => 'probe',
      p_new_sku          => 'probe',
      p_program_ids      => '{}'::uuid[]);
    insert into _probe55 values ('old call', 'resolved');
  exception
    when undefined_function then insert into _probe55 values ('old call', 'rejected');
    when raise_exception    then insert into _probe55 values ('old call', 'resolved');
  end;
end
$oldcall$;

-- THE RENAME, THROUGH THE FUNCTION, by argument name as PostgREST calls it.
do $probe$
declare
  v_id   uuid;
  v_rows int;
  v_rep  text;
  v_sku  text;
  v_name text;
  v_err  text;
begin
  begin
    insert into vessl.products (sku, name, active)
      values ('ZZTEST-OLD-55', 'ZZTEST rename probe 55', true)
      returning id into v_id;

    select count(*),
           string_agg(r.target_table || '.' || r.column_name || ' ' || coalesce(r.old_value, 'null')
                      || ' to ' || coalesce(r.new_value, 'null') || ' ' || r.changed::text, ',')
      into v_rows, v_rep
      from vessl.rename_product_sku(
             p_product_id       => v_id,
             p_expected_old_sku => 'ZZTEST-OLD-55',
             p_new_sku          => 'ZZTEST-NEW-55',
             p_quote_ids        => '{}'::uuid[],
             p_poi_ids          => '{}'::uuid[],
             p_soi_ids          => '{}'::uuid[],
             p_updated_by       => 'script 55') r;

    select p.sku, p.name into v_sku, v_name from vessl.products p where p.id = v_id;

    -- Undo the insert and the rename. The variables keep what they saw.
    raise exception using errcode = 'P0001', message = 'probe finished';
  exception when others then
    v_err := case when sqlerrm = 'probe finished' then 'none' else sqlerrm end;
  end;

  insert into _probe55 values
    ('rename error',      coalesce(v_err, 'null')),
    ('rename rows',       coalesce(v_rows::text, 'null')),
    ('rename report',     coalesce(v_rep, 'null')),
    ('sku after rename',  coalesce(v_sku, 'null')),
    ('name after rename', coalesce(v_name, 'null'));
end
$probe$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 the eight-argument function existed, as one overload' as chk,
         (select overloads_before::text || ' ' || args_before from _pre55) as got,
         '1 p_product_id uuid, p_expected_old_sku text, p_new_sku text, p_quote_ids uuid[], p_poi_ids uuid[], p_soi_ids uuid[], p_program_ids uuid[], p_updated_by text' as want
  union all
  select 'a1 and no ZZTEST product existed',
         (select zz_before::text from _pre55), '0'
  union all
  select 'b1 the signature is now the seven-argument one',
         (select pg_get_function_identity_arguments(p.oid)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'),
         'p_product_id uuid, p_expected_old_sku text, p_new_sku text, p_quote_ids uuid[], p_poi_ids uuid[], p_soi_ids uuid[], p_updated_by text'
  union all
  select 'b2 exactly one overload',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), '1'
  union all
  select 'b3 the body is byte-identical to before, line endings aside',
         (select (md5(replace(p.prosrc, chr(13), '')) = (select body_md5_before from _pre55))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), 'true'
  union all
  -- COMMENTS CUT OFF FIRST. The body keeps the tombstone comments saying what
  -- script 51 removed, and a search that counted them would fail a function that
  -- no longer touches the table. Each line is cut at its first double dash, and
  -- only what comes before it -- code and literals -- is searched.
  select 'b4 no reference to programs outside comments',
         (select (exists (select 1 from string_to_table(p.prosrc, chr(10)) as l(line)
                           where split_part(l.line, repeat('-', 2), 1) ~* '(^|[^a-z_])programs([^a-z_]|$)'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), 'false'
  union all
  select 'b5 it returns the same table shape',
         (select pg_get_function_result(p.oid)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'),
         'TABLE(target_table text, row_id uuid, column_name text, old_value text, new_value text, changed boolean)'
  union all
  select 'b6 four defaults, volatile, not strict',
         (select p.pronargdefaults::text || ' ' || p.provolatile::text || ' ' || p.proisstrict::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), '4 v false'
  union all
  select 'c1 security invoker, so RLS still applies',
         (select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), 'false'
  union all
  select 'c2 search_path re-pinned',
         (select array_to_string(p.proconfig, ',')::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), 'search_path=vessl, pg_catalog'
  union all
  select 'c3 the comment was re-applied verbatim',
         (select (md5(obj_description(p.oid, 'pg_proc')) = (select comment_md5_before from _pre55))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku'), 'true'
  union all
  select 'd1 anon cannot execute it',
         (select has_function_privilege('anon', 'vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], text)', 'execute')::text), 'false'
  union all
  select 'd2 authenticated can',
         (select has_function_privilege('authenticated', 'vessl.rename_product_sku(uuid, text, text, uuid[], uuid[], uuid[], text)', 'execute')::text), 'true'
  union all
  select 'd3 PUBLIC holds no privilege on it',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(p.proacl) a
           where n.nspname = 'vessl' and p.proname = 'rename_product_sku' and a.grantee = 0), '0'
  union all
  select 'e1 a call naming the dropped parameter is refused',
         (select value::text from _probe55 where step = 'old call'), 'rejected'
  union all
  select 'e2 the probe rename raised no error',
         (select value::text from _probe55 where step = 'rename error'), 'none'
  union all
  select 'e3 it reported exactly one row',
         (select value::text from _probe55 where step = 'rename rows'), '1'
  union all
  select 'e4 naming the product sku, old to new, changed',
         (select value::text from _probe55 where step = 'rename report'), 'products.sku ZZTEST-OLD-55 to ZZTEST-NEW-55 true'
  union all
  -- WHAT IT SAID AND WHAT THE TABLE DID, separately.
  select 'e5 the row itself read the new sku',
         (select value::text from _probe55 where step = 'sku after rename'), 'ZZTEST-NEW-55'
  union all
  select 'e6 and kept its name',
         (select value::text from _probe55 where step = 'name after rename'), 'ZZTEST rename probe 55'
  union all
  select 'f1 no ZZTEST product survives',
         (select count(*)::text from vessl.products where name like 'ZZTEST%' or sku like 'ZZTEST%'), '0'
  union all
  select 'f2 the catalogue is exactly the size it was',
         (select ((select count(*) from vessl.products) - products_before)::text from _pre55), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
