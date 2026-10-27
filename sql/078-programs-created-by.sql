-- 78 -- who created a PLM card, kept on the card.
--
-- WHAT IT DOES. Adds one nullable column, vessl.programs.created_by, and fills it
-- for exactly one existing row -- the ZZTESTPLM card -- by id. No grant is
-- changed and nothing else on the table is touched.
--
-- WHY A COLUMN. The board tile is to read Created by NAME and Last edited by
-- NAME. Last edited already exists -- updated_by and updated_at, stamped by every
-- path that changes a card. Created by does not. createProgram writes the
-- creator into updated_by on insert, and the first edit overwrites it, so the
-- creator is lost the moment anybody touches the card. created_at already holds
-- WHEN; this holds WHO.
--
-- AN EMAIL, NOT A STAFF ID, for the reason updated_by is an email -- an audit
-- crumb has to stay readable after a colleague leaves and their profile goes. The
-- board turns it into a full name through staffName, falling back to the address.
--
-- NULLABLE AND WITHOUT A DEFAULT. A card whose creator nobody recorded should
-- say nothing rather than name whoever ran this script. The tile shows Created
-- and the date alone when created_by is null.
--
-- THE ONE BACKFILL, on request. The ZZTESTPLM card is a throwaway test card, and
-- its creator is set to mattdillon@kinguniversal.com by id. The data cannot prove
-- who created it -- its updated_by has been overwritten since -- so this is a
-- stated fact from the person who made it, not an inference, and it is the only
-- row this script writes. Identity is the row id with its product and client ids
-- asserted beside it, never a name or a SKU.
--
-- THE BACKFILL IS NOT AN EDIT. It writes created_by only. updated_at and
-- updated_by are left alone, so the card does not start reporting a last edit by
-- whoever ran this. b6 asserts that. No trigger fires either -- the only trigger
-- on programs is trg_programs_declared_stage_at, on inserts and on updates OF
-- declared_stage, and this update does not name that column.
--
-- NO GRANT WORK, asserted rather than assumed, as script 77 did. authenticated
-- holds table level arwd on vessl.programs, and a table level privilege covers
-- a column added afterwards. REVOKE FIRST is the pattern for a NEW table, where
-- the schema default privileges arrive with it -- a new column on an existing
-- table brings no privileges of its own. b4 checks INSERT and SELECT reach the
-- new column, and b5 checks anon still reaches nothing.
--
-- MEASURED BEFORE WRITING, against the live database
--   vessl.programs -- 1 row, 18 columns, no created_by among them.
--   relacl is postgres arwdDxtm and authenticated arwd, anon holds nothing.
--   the ZZTESTPLM card is id 3e754941 with product bb06cd26 and client c4d3d761,
--   its product SKU is 9 characters, and mattdillon@kinguniversal.com is 28
--   characters and matches exactly one staff_profiles row.

begin;

-- PRE-STATE FIRST, before the column exists.
create temp table _pre78 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'created_by')                                   as col_before,
         (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs')           as all_cols_before,
         (select count(*) from vessl.programs)                                 as rows_before,
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass) as acl_before,
         (select count(*) from vessl.programs
           where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
             and product_id = 'bb06cd26-e1a1-4336-9c4e-b1f863da62a8'::uuid
             and client_company_id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid) as zz_match_before,
         (select updated_at from vessl.programs
           where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)             as zz_updated_at_before,
         (select updated_by from vessl.programs
           where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)             as zz_updated_by_before;

do $guard$
begin
  if (select col_before from _pre78) <> 0 then
    raise exception 'vessl.programs already has created_by, nothing changed';
  end if;
  -- The backfill names one row by id. If that id no longer carries the same
  -- product and client, it is not the card this script was written for.
  if (select zz_match_before from _pre78) <> 1 then
    raise exception 'the ZZTESTPLM card is not there with its product and client ids, nothing changed';
  end if;
  if not has_table_privilege('authenticated', 'vessl.programs', 'INSERT') then
    raise exception 'authenticated cannot insert into vessl.programs, so createProgram could not write created_by, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs
  add column created_by text;

comment on column vessl.programs.created_by is
  'Email of whoever created the card, written once by createProgram on insert and never updated. Null when nobody recorded it. The board shows it as a staff name.';

update vessl.programs
   set created_by = 'mattdillon@kinguniversal.com'
 where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid
   and product_id = 'bb06cd26-e1a1-4336-9c4e-b1f863da62a8'::uuid
   and client_company_id = 'c4d3d761-24e1-43f6-81aa-d96277bdbe8c'::uuid;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 created_by did not exist before' as chk,
         (select col_before::text from _pre78) as got, '0' as want
  union all
  select 'a1 the ZZTESTPLM card was there with its product and client',
         (select zz_match_before::text from _pre78), '1'
  union all
  select 'b1 created_by exists now as text',
         (select string_agg(data_type, ' ') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'created_by'), 'text'
  union all
  -- NULLABLE AND UNDEFAULTED. A default would name somebody as the creator of
  -- every card nobody recorded.
  select 'b2 created_by is nullable and carries no default',
         (select is_nullable || coalesce(column_default, 'none') from information_schema.columns
           where table_schema = 'vessl' and table_name = 'programs'
             and column_name = 'created_by'), 'YESnone'
  union all
  -- IDENTITY BY ID AND LENGTH. The value is compared by its length against the
  -- 28 measured, never by its characters.
  select 'b3 exactly one card has created_by, the ZZTESTPLM id, 28 characters',
         (select count(*)::text || '/' || coalesce(max(length(created_by))::text, 'none')
            from vessl.programs where created_by is not null), '1/28'
  union all
  select 'b3b and that one card is the ZZTESTPLM id',
         (select count(*)::text from vessl.programs
           where created_by is not null
             and id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid), '1'
  union all
  -- THE REASON THERE IS NO GRANT BLOCK, asserted.
  select 'b4 authenticated reaches the new column for insert and select',
         (select has_column_privilege('authenticated', 'vessl.programs', 'created_by', 'INSERT')::text || '/' ||
                 has_column_privilege('authenticated', 'vessl.programs', 'created_by', 'SELECT')::text),
         'true/true'
  union all
  select 'b5 anon still reaches nothing on programs',
         (select has_table_privilege('anon', 'vessl.programs', 'SELECT')::text || '/' ||
                 has_table_privilege('anon', 'vessl.programs', 'INSERT')::text), 'false/false'
  union all
  select 'b5b the table grant itself is unchanged',
         (select relacl::text from pg_class where oid = 'vessl.programs'::regclass),
         (select acl_before::text from _pre78)
  union all
  -- THE BACKFILL IS NOT AN EDIT. The last edit on the card still reads what it
  -- read before this script, so the tile does not credit whoever ran it.
  select 'b6 the ZZTESTPLM last edit is untouched',
         (select (updated_at = (select zz_updated_at_before from _pre78))::text || '/' ||
                 (updated_by = (select zz_updated_by_before from _pre78))::text
            from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid),
         'true/true'
  union all
  select 'c1 one column was added and nothing was dropped',
         (select ((select count(*) from information_schema.columns
                    where table_schema = 'vessl' and table_name = 'programs') - all_cols_before)::text
            from _pre78), '1'
  union all
  select 'c2 no program row was added or removed',
         (select ((select count(*) from vessl.programs) - rows_before)::text from _pre78), '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
