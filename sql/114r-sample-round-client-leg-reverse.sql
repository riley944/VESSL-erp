-- 114r -- Reverse 114. The seven client-leg columns are dropped from program_sample_rounds.
--
-- ============================================================================
-- WRITTEN WITH THE RECONSTRUCTED 114 ON 15 OCT, NOT BY RILEY. 114 WAS APPLIED
-- TO LIVE BY RILEY ON 14 OCT. CHECK WITH RILEY BEFORE RUNNING THIS.
-- ============================================================================
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 114. One transaction.
--
-- WHAT IT DOES. Drops received_date, client_sent_date, client_carrier,
-- client_tracking_number, client_received_date, client_feedback and
-- client_feedback_at. Every client leg recorded since 114 is LOST -- arrivals at
-- KUI, shipments to clients, their tracking, and client feedback. a0 shows how
-- many rounds hold any of it, so read it on the rehearsal before swapping to
-- commit. Every other column, row and grant stays, sent_by and the second
-- package (112, 113) included. Notes written from feedback stay in program_notes.
--
-- THE CODE FIRST. The Samples page client view reads these columns when it loads
-- and writes them from the shuttle buttons. It falls back to loading without
-- them, but every Record button would then be refused -- take the code out first.
--
-- GUARD. All seven columns exist.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0. Any b row is a failed check. Zero
-- rows means the query did not run. a0 always shows, with how many rounds lose data.

begin;

create temp table _pre114r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name in ('received_date', 'client_sent_date', 'client_carrier', 'client_tracking_number',
                            'client_received_date', 'client_feedback', 'client_feedback_at'))   as has_cols,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds;

do $guard$
begin
  if (select has_cols from _pre114r) <> 7 then
    raise exception 'not all seven client-leg columns exist, so 114 is not as it left things, nothing changed';
  end if;
end
$guard$;

-- How many rounds hold any client-leg value, read before the columns go.
create temp table _lost114r on commit drop as
  select count(*) as n_set from vessl.program_sample_rounds
   where received_date is not null or client_sent_date is not null or client_carrier is not null
      or client_tracking_number is not null or client_received_date is not null
      or client_feedback is not null or client_feedback_at is not null;

-- Every round, every column but the seven, so b2 can prove nothing else moved.
create temp table _rest114r on commit drop as
  select md5(coalesce(string_agg((to_jsonb(r) - 'received_date' - 'client_sent_date' - 'client_carrier'
                                  - 'client_tracking_number' - 'client_received_date' - 'client_feedback'
                                  - 'client_feedback_at')::text, '/' order by r.id), '')) as h_rest
    from vessl.program_sample_rounds r;

alter table vessl.program_sample_rounds drop column received_date;
alter table vessl.program_sample_rounds drop column client_sent_date;
alter table vessl.program_sample_rounds drop column client_carrier;
alter table vessl.program_sample_rounds drop column client_tracking_number;
alter table vessl.program_sample_rounds drop column client_received_date;
alter table vessl.program_sample_rounds drop column client_feedback;
alter table vessl.program_sample_rounds drop column client_feedback_at;

-- VERIFICATION. a0 (always shown, with the count) and z0 are a pass. Any b row is a
-- failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, all seven present; rounds losing client-leg data = '
           || (select n_set::text from _lost114r) as chk,
         (select has_cols::text from _pre114r) as got,
         '7' as want
  union all
  select 'b1 the seven columns are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name in ('received_date', 'client_sent_date', 'client_carrier', 'client_tracking_number',
                                 'client_received_date', 'client_feedback', 'client_feedback_at')),
         '0'
  union all
  select 'b2 every other column on every round unchanged, sent_by and package 2 included',
         (select case when md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                           = (select h_rest from _rest114r) then 'same' else 'changed' end
            from vessl.program_sample_rounds r),
         'same'
  union all
  select 'b3 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre114r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk like 'a0%'
   or chk = 'z0 verification ran'
order by chk;

-- Two rows, a0 and z0, and the count is what you expect? Then swap these two lines.
-- commit;
rollback;
