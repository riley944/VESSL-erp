-- 44 -- carry the existing awards from forwarder_bids.selected onto status.
--
-- RUN THIS BEFORE THE CODE SHIPS. Script 43 added the status values; it did not
-- populate them, and it could not, because until the code changed nothing had
-- decided that status was where an outcome lives.
--
-- ── WHAT BREAKS WITHOUT IT ──────────────────────────────────────────────────
-- The old page derived its Awarded tile from the bid flag.
--
--     const awarded = quotes.filter(q => !!winnerOf(q.id));
--
-- The new page reads status. Script 43 left all six rows sent, so on the first
-- load after the deploy the tiles would move Awarded 4 to 0 and Bids in 2 to 6,
-- and four decisions Kristy has already made would read as undecided.
--
-- Nothing is lost either way. forwarder_bids.selected still holds every one of
-- those decisions, which is exactly why this script can rebuild them.
--
-- ── DERIVED, NOT TYPED ──────────────────────────────────────────────────────
-- The mapping is not a list of six ids. It is the OLD RULE, run once.
--
--   awarded       a row whose bid carries selected
--   not_selected  a row with no selected bid, in a group where another row has one
--   sent          everything else, untouched
--
-- Written that way because the old rule is the thing being migrated. A hand list
-- would encode what the flags said when I measured them rather than what they say
-- when you run it, and the two are not guaranteed to match.
--
-- THE SECOND RULE ONLY REACHES A GROUPED ROW. A lone RFQ with no selected bid is
-- not a loser, it is simply undecided, and it stays sent. Only the Dallas trio is
-- grouped today, so this touches exactly the two rows that lost that shipment.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 6 rows, all status sent, all sent_at set, one bid each. 4 carry a selected bid
-- (FQ-Z5I1X, FQ-UZCK0, FQ-D1RQV, FQ-F3V23) and 2 do not (FQ-D8EZT, FQ-D8VDT),
-- both of them in the Dallas group behind FQ-D1RQV. Expected outcome 4 awarded,
-- 2 not_selected, 0 left sent. Rehearsal z0, commit z0.

begin;

create temp table _pre44 on commit drop as
  select (select count(*) from vessl.shipment_quotes)                       as rows_before,
         (select count(*) from vessl.forwarder_bids)                        as bids_before,
         (select count(*) from vessl.forwarder_bids where selected)         as sel_before,
         (select count(*) from vessl.shipment_quotes where status = 'sent') as sent_before;

create temp table _b44 on commit drop as
  select id, status, sent_at, rfq_group_id, quote_number from vessl.shipment_quotes;

-- The two sets, resolved ONCE up front against the flags as they stand. Resolving
-- them before either write means the second rule reads the pre-write world and
-- cannot be influenced by the first.
create temp table _win44 on commit drop as
  select distinct q.id
    from vessl.shipment_quotes q
    join vessl.forwarder_bids b on b.shipment_quote_id = q.id
   where b.selected
     and q.status = 'sent';

-- EXCEPT rather than `not in`, deliberately. The house rule is explicit equality
-- in filters and no NOT -- a set difference says the same thing without one, and
-- it also makes the no-overlap property structural rather than something a3 has
-- to hope for.
create temp table _lose44 on commit drop as
  select q.id
    from vessl.shipment_quotes q
   where q.status = 'sent'
     and q.rfq_group_id is not null
     and exists (select 1 from vessl.shipment_quotes w
                  where w.rfq_group_id = q.rfq_group_id
                    and w.id in (select id from _win44))
  except
  select id from _win44;

update vessl.shipment_quotes q
   set status = 'awarded', updated_at = now()
 where q.id in (select id from _win44);

update vessl.shipment_quotes q
   set status = 'not_selected', updated_at = now()
 where q.id in (select id from _lose44);

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 six rows, every one sent before this ran' as chk,
         (select count(*)::text from _b44 where status = 'sent') as got, '6' as want
  union all
  select 'a1 four of them carried a selected bid',
         (select count(*)::text from _win44), '4'
  union all
  select 'a2 and two grouped rows did not',
         (select count(*)::text from _lose44), '2'
  union all
  -- THE TWO SETS MUST NOT OVERLAP, or a row would be written twice and the last
  -- write would decide the outcome silently.
  select 'a3 no row is in both sets',
         (select count(*)::text from _win44 w join _lose44 l on l.id = w.id), '0'
  union all
  select 'b1 four rows are awarded',
         (select count(*)::text from vessl.shipment_quotes where status = 'awarded'), '4'
  union all
  select 'b2 two rows are not selected',
         (select count(*)::text from vessl.shipment_quotes where status = 'not_selected'), '2'
  union all
  select 'b3 nothing is left sent',
         (select count(*)::text from vessl.shipment_quotes where status = 'sent'), '0'
  union all
  -- EVERY AWARDED ROW STILL HAS THE BID THAT MADE IT AWARDED. This is the join
  -- between the two facts, and it is the one that must not drift.
  select 'b4 every awarded row still carries its selected bid',
         (select count(*)::text from vessl.shipment_quotes q
           where q.status = 'awarded'
             and exists (select 1 from vessl.forwarder_bids b
                          where b.shipment_quote_id = q.id and b.selected)), '4'
  union all
  select 'b5 and no not-selected row carries one',
         (select count(*)::text from vessl.shipment_quotes q
           where q.status = 'not_selected'
             and exists (select 1 from vessl.forwarder_bids b
                          where b.shipment_quote_id = q.id and b.selected)), '0'
  union all
  -- The Dallas group, which is the whole point. One winner, two not selected.
  select 'b6 the grouped trio reads one awarded and two not selected',
         (select count(*) filter (where status = 'awarded')::text || '/' ||
                 count(*) filter (where status = 'not_selected')::text
            from vessl.shipment_quotes where rfq_group_id is not null), '1/2'
  union all
  select 'c1 no bid was created, deleted or reselected',
         (select ((select count(*) from vessl.forwarder_bids) - (select bids_before from _pre44))::text || '/' ||
                 ((select count(*) from vessl.forwarder_bids where selected) - (select sel_before from _pre44))::text), '0/0'
  union all
  select 'c2 no rfq created or deleted',
         (select ((select count(*) from vessl.shipment_quotes) - (select rows_before from _pre44))::text), '0'
  union all
  select 'c3 no sent_at moved and no group changed',
         (select count(*)::text from _b44 b join vessl.shipment_quotes q on q.id = b.id
           where q.sent_at is not distinct from b.sent_at
             and q.rfq_group_id is not distinct from b.rfq_group_id), '6'
  union all
  select 'c4 every status is one the check allows',
         (select count(*)::text from vessl.shipment_quotes
           where status in ('draft','sent','awarded','not_selected','archived')), '6'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
