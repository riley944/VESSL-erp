-- 100r -- Reverse 100. Round notes stop following a renumbered round.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 100. One transaction.
--
-- WHAT IT DOES. Drops trg_round_note_numbers, then vessl.sync_round_note_numbers.
-- No note and no round is written. Notes already renumbered keep the number
-- they have now, which is the number of their round, so nothing is left out of
-- step. From then on a round renumbered from its Edit form leaves its notes on
-- the old number -- so take the stepper off the Edit form before running this.
--
-- GUARDS. Both the trigger and the function exist, which proves 100 ran.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre100r on commit drop as
  select
    (select count(*) from pg_trigger
      where tgrelid = 'vessl.program_sample_rounds'::regclass and tgname = 'trg_round_note_numbers') as has_trg,
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'vessl' and p.proname = 'sync_round_note_numbers')                      as has_fn,
    (select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
       from vessl.program_notes n)                                                               as h_notes,
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rounds;

do $guard$
begin
  if (select has_trg from _pre100r) <> 1 or (select has_fn from _pre100r) <> 1 then
    raise exception 'the trigger or the function is missing, so 100 is not in place, nothing changed';
  end if;
end
$guard$;

drop trigger trg_round_note_numbers on vessl.program_sample_rounds;
drop function vessl.sync_round_note_numbers();

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 the trigger and the function both existed' as chk,
         (select has_trg::text || '/' || has_fn::text from _pre100r) as got,
         '1/1' as want
  union all
  select 'b1 both are gone',
         (select (select count(*) from pg_trigger
                   where tgrelid = 'vessl.program_sample_rounds'::regclass and tgname = 'trg_round_note_numbers')::text
                 || '/' || (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                             where s.nspname = 'vessl' and p.proname = 'sync_round_note_numbers')::text),
         '0/0'
  union all
  select 'b2 every note and every round unchanged',
         (select ((select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
                     from vessl.program_notes n) = h_notes)::text
                 || '/' || ((select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                               from vessl.program_sample_rounds r) = h_rounds)::text
            from _pre100r),
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
