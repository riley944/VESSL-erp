-- 105r -- Reverse 105. The three cards go back to having no source quote.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 105. One transaction.
--
-- WHAT IT DOES. Sets source_quote_id back to NULL on the same three cards, by
-- id -- and only where each still names the quote 105 gave it, so a card
-- relinked since is left alone and the count check stops the script.
--
-- Like 105 it names source_quote_id alone, so updated_at and updated_by on the
-- cards do not move; b2 checks every other column.
--
-- GUARDS. All three cards exist and still name the quote 105 set; after the
-- update, exactly three rows were changed.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _map105r (card_id uuid, quote_id uuid) on commit drop;
insert into _map105r values
  ('7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 'd9768a5d-3bd8-42b6-8206-3ab8be8376cc'::uuid),
  ('c34fa69d-04b8-4399-ae92-172c28004c0f'::uuid, '474b7ba3-a0c0-4246-9286-3ff86a5a5fbc'::uuid),
  ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, '307e7902-56da-4d25-9a78-4349522880b7'::uuid);

create temp table _pre105r on commit drop as
  select
    (select count(*) from vessl.programs p join _map105r m
        on m.card_id = p.id and p.source_quote_id = m.quote_id)                                 as n_linked,
    (select count(*) from vessl.programs)                                                       as n_cards,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), ''))
       from vessl.programs p)                                                                   as h_rest;

do $guard$
begin
  if (select n_linked from _pre105r) <> 3 then
    raise exception 'only % of the 3 cards still name the quote 105 gave them -- nothing changed', (select n_linked from _pre105r);
  end if;
end
$guard$;

create temp table _done105r (n int) on commit drop;

do $unset$
declare
  n integer;
begin
  update vessl.programs p
     set source_quote_id = null
    from _map105r m
   where p.id = m.card_id
     and p.source_quote_id = m.quote_id;
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'the update changed % rows, not 3 -- nothing changed', n;
  end if;
  insert into _done105r values (n);
end
$unset$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 all three cards named the quote 105 gave them' as chk,
         (select n_linked::text from _pre105r) as got,
         '3' as want
  union all
  select 'b1 exactly three rows changed, and the three cards name no quote now',
         (select n::text from _done105r) || '/'
         || (select count(*) from vessl.programs p join _map105r m on m.card_id = p.id
              where p.source_quote_id is null)::text,
         '3/3'
  union all
  select 'b2 every other column of every card unchanged -- updated_at and updated_by included -- and the same cards',
         (select (md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), '')) = x.h_rest)::text
                 || '/' || (count(*) = x.n_cards)::text
            from vessl.programs p, _pre105r x group by x.h_rest, x.n_cards),
         'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
