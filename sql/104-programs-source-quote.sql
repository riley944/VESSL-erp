-- 104 -- PLM cards remember the quote they were created from.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 104r.
--
-- WHY. A card can be created from a quote -- Create PLM Card on a quote, and the
-- Quote ID box on the PLM page (1 Oct). The card shows "From quote Q-0356" and
-- links to it, so it has to keep which quote that was.
--
-- WHAT IT DOES. One nullable column, vessl.programs.source_quote_id, a foreign
-- key to vessl.quotes(id) ON DELETE SET NULL -- deleting a quote never deletes or
-- blocks a card, the card just stops naming it. An index on it. The key is the
-- uuid, not the Q-code, so the link holds whatever happens to the code column.
--
-- EXISTING CARDS ARE LEFT EMPTY, on decision -- the 3 cards on the board on 1 Oct
-- name no source quote. Only cards created from a quote after this get one.
--
-- NO GRANT CHANGES. authenticated holds table-level INSERT and UPDATE on
-- programs, which covers a column added later; b2 checks it. Row security on
-- programs (staff_only) is untouched. No trigger is added; the one already there
-- stamps declared_stage_at and fires only on a stage change.
--
-- GUARDS, before any change. The column does not exist; the ZZTESTPLM card and
-- its quote Q-0340, which the probes use, exist by id; nothing references
-- quotes yet, so the delete probe touches nothing else.
--
-- PROBES, each undone
--   p1 as a signed-in staff user -- a card can be pointed at a quote
--   p2 as a signed-in staff user -- a card cannot be pointed at a quote that
--      does not exist (refused by the foreign key)
--   p3 as postgres -- deleting the quote a card points at leaves the card, with
--      source_quote_id now NULL
--
-- NO EMAIL. Neither table has a mailing trigger.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre104 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'programs' and column_name = 'source_quote_id') as has_col,
    (select count(*) from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)      as zz_card,
    (select count(*) from vessl.quotes
      where id = '307e7902-56da-4d25-9a78-4349522880b7'::uuid and quote_code = 'Q-0340')                as zz_quote,
    (select count(*) from pg_constraint where confrelid = 'vessl.quotes'::regclass)                    as refs_to_quotes,
    (select count(*) from vessl.programs)                                                              as n_cards,
    (select count(*) from vessl.quotes)                                                                as n_quotes,
    (select md5(coalesce(string_agg(to_jsonb(p)::text, '/' order by p.id), '')) from vessl.programs p) as h_cards;

do $guard$
begin
  if (select has_col from _pre104) <> 0 then
    raise exception 'programs already has source_quote_id, nothing changed';
  end if;
  if (select zz_card from _pre104) <> 1 or (select zz_quote from _pre104) <> 1 then
    raise exception 'the ZZTESTPLM card or its quote Q-0340 is missing, so the probes cannot run, nothing changed';
  end if;
  if (select refs_to_quotes from _pre104) <> 0 then
    raise exception 'something already references quotes, so the delete probe could reach it, nothing changed';
  end if;
end
$guard$;

alter table vessl.programs
  add column source_quote_id uuid
    constraint programs_source_quote_id_fkey
    references vessl.quotes (id) on delete set null;
create index programs_source_quote_id_idx on vessl.programs (source_quote_id);

comment on column vessl.programs.source_quote_id is
  'Script 104. The quote this card was created from -- by Create PLM Card on a quote or the Quote ID box on the PLM page. NULL for cards made before it, or when that quote has since been deleted.';

create temp table _probe104 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  got uuid;
begin
  -- p1 -- point the card at a quote, as staff.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.programs set source_quote_id = '307e7902-56da-4d25-9a78-4349522880b7'::uuid
     where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe104 select 1, case when n = 1 then 'ok' else 'norow' end;
  end;

  -- p2 -- a quote that does not exist, as staff.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.programs set source_quote_id = '00000000-0000-0000-0000-000000000000'::uuid
     where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    raise exception 'probe undo';
  exception
    when foreign_key_violation then insert into _probe104 values (2, 'refused');
    when raise_exception then insert into _probe104 values (2, 'accepted');
  end;

  -- p3 -- delete the quote the card points at, as postgres.
  begin
    update vessl.programs set source_quote_id = '307e7902-56da-4d25-9a78-4349522880b7'::uuid
     where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    delete from vessl.quotes where id = '307e7902-56da-4d25-9a78-4349522880b7'::uuid;
    select count(*) into n from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    select source_quote_id into got from vessl.programs where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid;
    raise exception 'probe undo';
  exception
    when raise_exception then
      insert into _probe104 values (3, case when n = 1 and got is null then 'kept, cleared' else 'not as expected' end);
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 no column yet, probe card and quote present, nothing referencing quotes' as chk,
         (select has_col::text || '/' || zz_card::text || '/' || zz_quote::text || '/' || refs_to_quotes::text from _pre104) as got,
         '0/1/1/0' as want
  union all
  select 'b1 source_quote_id is a nullable uuid, its key points at quotes and sets NULL on delete, and it is indexed',
         ((select data_type || ' ' || is_nullable from information_schema.columns
            where table_schema = 'vessl' and table_name = 'programs' and column_name = 'source_quote_id')
          || '/' || (select confrelid::regclass::text || ' ' || confdeltype::text from pg_constraint
                      where conrelid = 'vessl.programs'::regclass and conname = 'programs_source_quote_id_fkey')
          || '/' || (select count(*) from pg_indexes
                      where schemaname = 'vessl' and indexname = 'programs_source_quote_id_idx')::text),
         'uuid YES/vessl.quotes n/1'
  union all
  select 'b2 staff can write it -- insert and update on the column',
         (select has_column_privilege('authenticated', 'vessl.programs', 'source_quote_id', 'INSERT')::text || '/'
                 || has_column_privilege('authenticated', 'vessl.programs', 'source_quote_id', 'UPDATE')::text),
         'true/true'
  union all
  select 'b3 probes -- set by staff, unknown quote refused, card kept and cleared when its quote is deleted',
         (select string_agg(result, '/' order by step) from _probe104), 'ok/refused/kept, cleared'
  union all
  select 'b4 every existing card empty, every other column unchanged, no card or quote lost',
         (select count(source_quote_id)::text from vessl.programs)
         || '/' || (select (md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), '')) = x.h_cards)::text
                      from vessl.programs p, _pre104 x group by x.h_cards)
         || '/' || (select ((select count(*) from vessl.programs) = n_cards and (select count(*) from vessl.quotes) = n_quotes)::text
                      from _pre104),
         '0/true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
