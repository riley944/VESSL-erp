-- 43 -- RFQ outcomes. rfq_group_id, a status CHECK, and the Dallas trio grouped.
--
-- Kristy gets bids from three forwarders on one shipment, picks one, and has been
-- DELETING the other two. This script is the schema half of keeping them instead.
--
-- ── WHAT THE DELETING HAS ALREADY COST ──────────────────────────────────────
-- The 2026-09-08 census counted 12 sent RFQs, 11 with no bid recorded. Today
-- there are SIX, and forwarder_bids holds six rows -- one each.
--
-- forwarder_bids_shipment_quote_id_fkey is ON DELETE CASCADE, so each delete took
-- the bids on that RFQ with it. No warning, no audit table, nothing to restore.
-- Six RFQs and whatever bids they held are simply gone. That is the cost this
-- change exists to stop, and it is recorded in CATALOGUE rather than only here.
--
-- ── WHY A GROUP COLUMN, AND NOT AN INFERENCE ────────────────────────────────
-- "Set every OTHER RFQ for the same shipment to not_selected" needs to know which
-- rows are the same shipment. Nothing in this table says so. po_id exists and is
-- NULL on all six. There is no shipment_id.
--
-- The three Dallas rows are provably one shipment -- same client, same origin
-- text, same destination text, 20GP, 500 cartons, 10.85 CBM, created inside two
-- and a half minutes. But INFERRING that at runtime would be wrong, and this table
-- already proves why. FQ-UZCK0 carries the origin Shenyang and FQ-D1RQV carries
-- Shenyang comma China, and those two are NOT the same shipment. A rule keyed on
-- free text would join them, or miss a real trio the day somebody types a comma.
--
-- So the group is a column, written when a duplicate is made, and NULL means "not
-- grouped" rather than a guess. Code that finds no group declines to auto-set
-- siblings and says so, which is the honest behaviour for an unknown.
--
-- ── THE BACKFILL IS THREE ROWS AND NOT ONE MORE ─────────────────────────────
-- Only the Dallas trio. The other three RFQs are each the only quote for their
-- route and get NULL -- a lone RFQ is not a group of one, and inventing group ids
-- for them would put a value in a column that means something it does not.
--
--   cb5714bb  FQ-D1RQV  Ship Tech Intl   Shenyang, China -> Dallas, TX
--   60f9c025  FQ-D8EZT  Sine Trading     Shenyang, China -> Dallas, TX
--   4006c2ca  FQ-D8VDT  CargoBrokers     Shenyang, China -> Dallas, TX
--
-- ── STATUS BECOMES NOT NULL, WHICH IS MORE THAN THE BRIEF ASKED ─────────────
-- READ THIS ONE. The brief asked for a CHECK. This also sets NOT NULL, because
-- the UI reads status not-equal-sent to mean draft, so a NULL status would
-- render as a draft, and a plain IN check passes NULL silently. Zero rows are
-- NULL today and the column defaults to draft, so this costs nothing now and
-- closes the hole permanently.
--
-- TO SKIP IT, delete the alter-column-status-set-not-null line and change the b6
-- want to false. Nothing else depends on it.
--
-- ── MEASURED BEFORE WRITING, against the live database ──────────────────────
-- 6 rows, every one status sent, 0 NULL. 6 bids. No rfq_group_id column, no
-- check constraint, 1 index, 3 policies, RLS on. Quote numbers are 8 characters
-- each. For the trio, origin is 15 and destination 10. Rehearsal z0, commit z0.

begin;

create temp table _pre43 on commit drop as
  select (select count(*) from vessl.shipment_quotes)                        as rows_before,
         (select count(*) from vessl.forwarder_bids)                         as bids_before,
         (select count(*) from vessl.shipment_quotes where status = 'sent')  as sent_before,
         (select count(*) from pg_policies
           where schemaname = 'vessl' and tablename = 'shipment_quotes')     as policies_before,
         (select count(*) from pg_indexes
           where schemaname = 'vessl' and tablename = 'shipment_quotes')     as idx_before;

-- The trio, keyed on id and guarded by the raw lengths of the three text fields
-- that make them one shipment. A row whose text has been edited since measuring
-- fails a0 rather than being grouped on a stale premise.
create temp table _m43 (qid uuid, qn_len int, o_len int, d_len int) on commit drop;
insert into _m43 values
  ('cb5714bb-1c49-4d98-a685-2593b8d33d4f'::uuid, 8, 15, 10),
  ('60f9c025-8240-463c-87b5-7091d4a8f814'::uuid, 8, 15, 10),
  ('4006c2ca-abc3-4e8a-9ade-1b6a7dacbed4'::uuid, 8, 15, 10);

-- One id for the group, generated here so it is not a literal somebody could
-- paste twice into two different scripts.
create temp table _g43 on commit drop as select gen_random_uuid() as gid;

create temp table _b43 on commit drop as
  select id, status, sent_at, quote_number from vessl.shipment_quotes;

-- 1. THE COLUMN. Nullable on purpose -- NULL is "not grouped".
alter table vessl.shipment_quotes add column rfq_group_id uuid;

-- 2. Partial, because the column is NULL on most rows and the only lookup that
--    matters is "the other RFQs in this group".
create index shipment_quotes_rfq_group_id_idx
  on vessl.shipment_quotes (rfq_group_id) where rfq_group_id is not null;

-- 3. THE STATUS DOMAIN, named so b5 can prove this one exists rather than counting.
alter table vessl.shipment_quotes
  add constraint shipment_quotes_status_check
  check (status in ('draft','sent','awarded','not_selected','archived'));

-- See the header. Delete this line and change the b6 want to skip it.
alter table vessl.shipment_quotes alter column status set not null;

-- 4. THE BACKFILL. Three rows, guarded on all three lengths.
update vessl.shipment_quotes q
   set rfq_group_id = (select gid from _g43)
  from _m43 m
 where q.id = m.qid
   and q.rfq_group_id is null
   and length(q.quote_number) = m.qn_len
   and length(q.origin)       = m.o_len
   and length(q.destination)  = m.d_len;

-- 5. THE CONSTRAINT MUST ACTUALLY CONSTRAIN. A CHECK that silently accepts
--    anything is worse than none, because everything downstream then trusts it.
--    The write is attempted inside a subtransaction and rolled back either way.
do $$
declare v_id uuid;
begin
  select id into v_id from vessl.shipment_quotes limit 1;
  begin
    update vessl.shipment_quotes set status = 'zzz_not_a_status' where id = v_id;
    raise exception 'the status CHECK did not fire -- it accepted a value outside its list';
  exception when check_violation then
    null;
  end;
end $$;

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 three trio rows, at their exact measured lengths' as chk,
         (select count(*)::text from vessl.shipment_quotes q join _m43 m on m.qid = q.id
           where length(q.quote_number) = m.qn_len
             and length(q.origin)       = m.o_len
             and length(q.destination)  = m.d_len) as got, '3' as want
  union all
  select 'a1 and every row already held a status inside the new list',
         (select count(*)::text from _b43
           where status in ('draft','sent','awarded','not_selected','archived')), '6'
  union all
  select 'a2 no row had a null status before the not null was set',
         (select count(*)::text from _b43 where status is null), '0'
  union all
  select 'b1 exactly three rows are grouped',
         (select count(*)::text from vessl.shipment_quotes where rfq_group_id is not null), '3'
  union all
  select 'b2 and they are exactly the trio',
         (select count(*)::text from vessl.shipment_quotes q join _m43 m on m.qid = q.id
           where q.rfq_group_id is not null), '3'
  union all
  select 'b3 sharing one group id between them',
         (select count(distinct rfq_group_id)::text from vessl.shipment_quotes
           where rfq_group_id is not null), '1'
  union all
  -- THE THREE THAT ARE NOT A GROUP. Lone RFQs stay NULL.
  select 'b4 the other three are ungrouped',
         (select count(*)::text from vessl.shipment_quotes where rfq_group_id is null), '3'
  union all
  select 'b5 the status check exists, by name',
         (select count(*)::text from pg_constraint
           where conrelid = 'vessl.shipment_quotes'::regclass
             and conname = 'shipment_quotes_status_check'), '1'
  union all
  select 'b6 status is not null',
         (select (a.attnotnull)::text from pg_attribute a
           where a.attrelid = 'vessl.shipment_quotes'::regclass
             and a.attname = 'status' and a.attnum > 0), 'true'
  union all
  select 'b7 the partial index exists, by name',
         (select count(*)::text from pg_indexes
           where schemaname = 'vessl' and tablename = 'shipment_quotes'
             and indexname = 'shipment_quotes_rfq_group_id_idx'), '1'
  union all
  -- Step 5 raises rather than reporting, so reaching this line at all means the
  -- constraint rejected the bad value.
  select 'b8 the check rejected a value outside its list', 'rejected', 'rejected'
  union all
  select 'c1 no rfq created or deleted',
         (select ((select count(*) from vessl.shipment_quotes) - (select rows_before from _pre43))::text), '0'
  union all
  select 'c2 no bid created or deleted',
         (select ((select count(*) from vessl.forwarder_bids) - (select bids_before from _pre43))::text), '0'
  union all
  select 'c3 every status is exactly what it was',
         (select count(*)::text from _b43 b join vessl.shipment_quotes q on q.id = b.id
           where q.status is not distinct from b.status), '6'
  union all
  select 'c4 all six are still sent',
         (select count(*)::text from vessl.shipment_quotes where status = 'sent'), '6'
  union all
  select 'c5 no sent_at moved',
         (select count(*)::text from _b43 b join vessl.shipment_quotes q on q.id = b.id
           where q.sent_at is not distinct from b.sent_at), '6'
  union all
  select 'c6 policies and row level security unchanged',
         (select (select count(*) from pg_policies
                   where schemaname = 'vessl' and tablename = 'shipment_quotes')::text
                 || ' rls ' ||
                 (select c.relrowsecurity::text from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'vessl' and c.relname = 'shipment_quotes')),
         (select policies_before::text || ' rls true' from _pre43)
  union all
  select 'c7 indexes up by exactly one',
         (select ((select count(*) from pg_indexes
                    where schemaname = 'vessl' and tablename = 'shipment_quotes')
                - (select idx_before from _pre43))::text), '1'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
