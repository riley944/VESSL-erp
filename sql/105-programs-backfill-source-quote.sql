-- 105 -- PLM, the three cards made before script 104 get their source quote.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 105r.
--
-- WHY. Script 104 left cards made before it with no source quote, on decision.
-- Each of the three on the board has exactly one quote for its product and
-- client (measured 1 Oct), and Matt chose that quote for each.
--   BUC-158   Buc-ees     card 7069a225   quote Q-0348  d9768a5d
--   JO-118    Johnnie-O   card c34fa69d   quote Q-0350  474b7ba3
--   zztestplm ZZTESTER    card 3e754941   quote Q-0340  307e7902
--
-- WHAT IT DOES. One update, by card id, setting source_quote_id -- and only where
-- it is still NULL, so a card somebody has linked since is left alone and the
-- count check then stops the script.
--
-- IT DOES NOT TOUCH updated_at OR updated_by. The update names source_quote_id
-- alone, and the only trigger on programs (trg_programs_declared_stage_at) fires
-- only on a change of declared_stage, so the tiles keep their Last edited line.
-- b3 proves every other column of every card is unchanged.
--
-- GUARDS, before any change
--   each card exists by id and has no source quote yet
--   each quote exists by id with its expected code, and belongs to the same
--   product AND the same client company as its card
--   exactly three cards and three quotes match
-- and, after the update, exactly three rows were changed.
--
-- NO EMAIL. programs has no mailing trigger.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _map105 (card_id uuid, quote_id uuid, quote_code text) on commit drop;
insert into _map105 values
  ('7069a225-f04a-40e9-87d9-9df19b6479fc'::uuid, 'd9768a5d-3bd8-42b6-8206-3ab8be8376cc'::uuid, 'Q-0348'),
  ('c34fa69d-04b8-4399-ae92-172c28004c0f'::uuid, '474b7ba3-a0c0-4246-9286-3ff86a5a5fbc'::uuid, 'Q-0350'),
  ('3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid, '307e7902-56da-4d25-9a78-4349522880b7'::uuid, 'Q-0340');

create temp table _pre105 on commit drop as
  select
    -- Cards that exist and have no source quote yet.
    (select count(*) from vessl.programs p join _map105 m on m.card_id = p.id
      where p.source_quote_id is null)                                                          as n_cards_empty,
    -- Quotes that exist with the expected code and sit on the same product
    -- and client as their card.
    (select count(*) from _map105 m
       join vessl.programs p on p.id = m.card_id
       join vessl.quotes q on q.id = m.quote_id
      where q.quote_code = m.quote_code
        and q.product_id = p.product_id
        and q.client_company_id = p.client_company_id)                                          as n_matched,
    (select count(*) from vessl.programs)                                                       as n_cards,
    (select md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), ''))
       from vessl.programs p)                                                                   as h_rest;

do $guard$
begin
  if (select n_cards_empty from _pre105) <> 3 then
    raise exception 'expected 3 cards with no source quote, found % -- nothing changed', (select n_cards_empty from _pre105);
  end if;
  if (select n_matched from _pre105) <> 3 then
    raise exception 'only % of the 3 quotes have the expected code and the same product and client as their card -- nothing changed',
      (select n_matched from _pre105);
  end if;
end
$guard$;

create temp table _done105 (n int) on commit drop;

do $set$
declare
  n integer;
begin
  update vessl.programs p
     set source_quote_id = m.quote_id
    from _map105 m
   where p.id = m.card_id
     and p.source_quote_id is null;
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'the update changed % rows, not 3 -- nothing changed', n;
  end if;
  insert into _done105 values (n);
end
$set$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 three empty cards, three quotes on the same product and client' as chk,
         (select n_cards_empty::text || '/' || n_matched::text from _pre105) as got,
         '3/3' as want
  union all
  select 'b1 exactly three rows changed',
         (select n::text from _done105), '3'
  union all
  select 'b2 each card now names its chosen quote -- JO-118 then BUC-158 then zztestplm',
         (select string_agg(coalesce(q.quote_code, 'none'), '/' order by m.quote_code desc)
            from _map105 m
            join vessl.programs p on p.id = m.card_id
            left join vessl.quotes q on q.id = p.source_quote_id),
         'Q-0350/Q-0348/Q-0340'
  union all
  select 'b3 every other column of every card unchanged -- updated_at and updated_by included -- and the same cards',
         (select (md5(coalesce(string_agg((to_jsonb(p) - 'source_quote_id')::text, '/' order by p.id), '')) = x.h_rest)::text
                 || '/' || (count(*) = x.n_cards)::text
            from vessl.programs p, _pre105 x group by x.h_rest, x.n_cards),
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
