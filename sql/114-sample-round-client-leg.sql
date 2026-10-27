-- 114 -- Sample rounds record the client leg of the shuttle, in seven columns.
--
-- ============================================================================
-- THIS FILE IS A RECONSTRUCTION, NOT THE ORIGINAL SCRIPT 114 WRITTEN BY RILEY.
-- RILEY APPLIED 114 TO THE LIVE DATABASE ON 14 OCT AND THE FILE NEVER REACHED
-- THIS FOLDER. THIS COPY WAS WRITTEN ON 15 OCT FROM THE LIVE SCHEMA, READ WITH
-- information_schema ONLY. IT WAS NEVER RUN BY US, BECAUSE THE COLUMNS WERE
-- ALREADY LIVE. REPLACE IT WITH THE ORIGINAL WHEN RILEY SENDS IT.
-- ============================================================================
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 114r.
--
-- WHAT IT DOES. Seven columns on vessl.program_sample_rounds, all nullable, no
-- defaults, no CHECK, as they stand live (measured read-only 15 Oct).
--   received_date          date         -- the sample arrived at KUI
--   client_sent_date       date         -- KUI sent it on to the client
--   client_carrier         text         -- that leg, carrier by name
--   client_tracking_number text         -- that leg, tracking number
--   client_received_date   date         -- the client had it
--   client_feedback        text         -- what the client said
--   client_feedback_at     timestamptz  -- when that was logged
-- Every existing round reads NULL in all seven -- no backfill.
--
-- A SAFE NO-OP WHERE THE COLUMNS ALREADY EXIST, which is the live database. If
-- all seven are present it adds nothing, changes no comment, says so in a1, and
-- still runs the probes and checks. If only some are present it stops, since
-- that is a state neither this script nor the original would leave.
--
-- NO GRANT CHANGES. Scripts 80 and 82 granted select, insert, update and delete
-- to authenticated ON THE TABLE, and a table grant covers columns added later.
-- The guard checks that no column of the table carries a column-level grant.
-- Probe p1 proves a signed-in staff user can write all seven.
--
-- GUARDS, before any change.
--   none of the seven exists, or all seven do
--   no column of the table has a column-level grant
--   there is at least one round, for the probes to use
--
-- PROBES, each undone. As Jenn signed in through the app (authenticated, a
-- kinguniversal.com identity) -- all seven set, then all seven back to NULL,
-- each accepted.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a1 and z0, on the rehearsal and again on the
-- commit. a1 always shows and names the path taken -- added, or skipped because
-- all seven were already present. Any a0 or b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre114 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'program_sample_rounds'
        and column_name in ('received_date', 'client_sent_date', 'client_carrier', 'client_tracking_number',
                            'client_received_date', 'client_feedback', 'client_feedback_at'))   as has_new,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.program_sample_rounds'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.program_sample_rounds)                                           as n_rounds,
    (select id from vessl.program_sample_rounds order by id limit 1)                             as probe_id,
    -- Every round, every column, so b3 can prove nothing moved on the skip path.
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rows,
    -- Every round, every column but the seven, for b2 on either path.
    (select md5(coalesce(string_agg((to_jsonb(r) - 'received_date' - 'client_sent_date' - 'client_carrier'
                                     - 'client_tracking_number' - 'client_received_date' - 'client_feedback'
                                     - 'client_feedback_at')::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rest;

do $guard$
begin
  if (select has_new from _pre114) not in (0, 7) then
    raise exception 'only some of the seven client-leg columns exist, nothing changed';
  end if;
  if (select n_colacl from _pre114) <> 0 then
    raise exception 'a column of program_sample_rounds has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
  if (select n_rounds from _pre114) < 1 then
    raise exception 'no rounds to probe with, nothing changed';
  end if;
end
$guard$;

-- The change, only where none of the seven exists. On the live database all
-- seven do, and this block does nothing.
do $add$
begin
  if (select has_new from _pre114) = 0 then
    alter table vessl.program_sample_rounds add column received_date date;
    alter table vessl.program_sample_rounds add column client_sent_date date;
    alter table vessl.program_sample_rounds add column client_carrier text;
    alter table vessl.program_sample_rounds add column client_tracking_number text;
    alter table vessl.program_sample_rounds add column client_received_date date;
    alter table vessl.program_sample_rounds add column client_feedback text;
    alter table vessl.program_sample_rounds add column client_feedback_at timestamptz;
    comment on column vessl.program_sample_rounds.received_date is
      'The day the sample arrived at KUI (script 114).';
    comment on column vessl.program_sample_rounds.client_sent_date is
      'The day KUI sent the sample on to the client (script 114).';
    comment on column vessl.program_sample_rounds.client_carrier is
      'The carrier of the leg to the client, by name, as carrier is (script 114).';
    comment on column vessl.program_sample_rounds.client_tracking_number is
      'The tracking number of the leg to the client (script 114).';
    comment on column vessl.program_sample_rounds.client_received_date is
      'The day the client had the sample (script 114).';
    comment on column vessl.program_sample_rounds.client_feedback is
      'What the client said about the sample (script 114).';
    comment on column vessl.program_sample_rounds.client_feedback_at is
      'When the client feedback was logged (script 114).';
  end if;
end
$add$;

create temp table _probe114 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  pid uuid := (select probe_id from _pre114);
  st text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1 and p2, as a signed-in staff user -- all seven set, then all seven blank.
  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds
       set received_date = current_date, client_sent_date = current_date, client_carrier = 'Probe carrier',
           client_tracking_number = 'PROBE114', client_received_date = current_date,
           client_feedback = 'Probe feedback', client_feedback_at = now()
     where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe114 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.program_sample_rounds
       set received_date = current_date, client_carrier = 'Probe carrier', client_feedback = 'Probe feedback'
     where id = pid;
    update vessl.program_sample_rounds
       set received_date = null, client_sent_date = null, client_carrier = null, client_tracking_number = null,
           client_received_date = null, client_feedback = null, client_feedback_at = null
     where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe114 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. Two rows, a1 and z0, is a pass. Any other row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 before, none or all seven present, no column-level grants, at least one round' as chk,
         (select (has_new in (0, 7))::text || '/' || n_colacl::text || '/' || (n_rounds > 0)::text from _pre114) as got,
         'true/0/true' as want
  union all
  select 'a1 path taken = '
           || (select case when has_new = 7 then 'skipped, all seven were already present, nothing added'
                           else 'added the seven columns' end from _pre114),
         'shown', 'always'
  union all
  select 'b1 the seven columns exist, nullable, no default, with these types',
         (select string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, 'none'),
                            '/' order by column_name)
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'program_sample_rounds'
             and column_name in ('received_date', 'client_sent_date', 'client_carrier', 'client_tracking_number',
                                 'client_received_date', 'client_feedback', 'client_feedback_at')),
         'client_carrier text YES none/client_feedback text YES none/client_feedback_at timestamp with time zone YES none/'
           || 'client_received_date date YES none/client_sent_date date YES none/client_tracking_number text YES none/'
           || 'received_date date YES none'
  union all
  select 'b2 every other column on every round unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(r) - 'received_date' - 'client_sent_date' - 'client_carrier'
                                                    - 'client_tracking_number' - 'client_received_date' - 'client_feedback'
                                                    - 'client_feedback_at')::text, '/' order by r.id), ''))
                           = (select h_rest from _pre114) then 'same' else 'changed' end
            from vessl.program_sample_rounds r),
         'same'
  union all
  select 'b3 skipped, every round unchanged in full; added, the seven blank on all',
         (select case when (select has_new from _pre114) = 7
                      then case when md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                                     = (select h_rows from _pre114) then 'same' else 'changed' end
                      else case when count(*) filter (where received_date is not null or client_sent_date is not null
                                                        or client_carrier is not null or client_tracking_number is not null
                                                        or client_received_date is not null or client_feedback is not null
                                                        or client_feedback_at is not null) = 0
                                then 'same' else 'changed' end
                 end
            from vessl.program_sample_rounds r),
         'same'
  union all
  select 'b4 same number of rounds',
         ((select count(*) from vessl.program_sample_rounds)::text), (select n_rounds::text from _pre114)
  union all
  select 'b5 probes -- staff can set and clear all seven',
         (select string_agg(result, ' | ' order by step) from _probe114),
         'allowed 1 | allowed 1'
  union all
  select 'b6 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.program_sample_rounds'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- Two rows, a1 and z0? Then swap these two lines. On the live database the
-- commit changes nothing, since all seven columns are already there.
-- commit;
rollback;
