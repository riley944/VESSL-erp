-- 116 -- Client price sheet wording. quotes gain client_details and client_color; staff_profiles gains job_title.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 116r.
--
-- WHAT IT DOES. Three columns, nothing else.
--   vessl.quotes.client_details, nullable text, no default -- the Details column
--     of the client price sheet, in words meant for the client.
--   vessl.quotes.client_color, nullable text, no default -- the Color column.
--   vessl.staff_profiles.job_title, nullable text, no default -- the title on
--     the sheet sign-off, for example VP of Sales.
-- Every existing quote and staff row reads NULL -- no backfill.
--
-- NO GRANT CHANGES. The app already selects and updates both tables as a
-- signed-in user, under table-level grants, and a table grant covers columns
-- added later. The guard checks that neither table carries a column-level grant.
-- The policies name no columns.
--
-- THE STAFF GUARDS STAY AS THEY ARE. Script 110 (trg_guard_staff_identity)
-- refuses, from the app, any change to another person row and any change to
-- role, email, auth_user_id or hide_financials. It names those columns rather
-- than allowing a list, so a person can set their own job_title and nobody can
-- set anybody else. Probes p3 and p4 prove both. Script 109 is untouched.
--
-- GUARDS, before any change.
--   none of the three columns exists yet
--   no column of either table has a column-level grant
--   there is at least one quote, for the probes to use
--   the two staff rows the probes use are where 110 found them, by id and by
--   the length of their email -- Matt (28) and Kristy (24)
--   trg_guard_staff_identity is present
--
-- PROBES, each undone.
--   p1 and p2, as Jenn signed in through the app -- a quote takes client_details
--     and client_color, then both go back to NULL, each accepted.
--   p3, as Matt signed in through the app -- his own job_title set, then back to
--     NULL, accepted.
--   p4, as Matt -- job_title on Kristy row, refused by the 110 guard.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a or b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre116 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl'
        and ((table_name = 'quotes' and column_name in ('client_details', 'client_color'))
          or (table_name = 'staff_profiles' and column_name = 'job_title')))                   as has_new,
    (select count(*) from pg_attribute
      where attrelid in ('vessl.quotes'::regclass, 'vessl.staff_profiles'::regclass)
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.quotes)                                                          as n_quotes,
    (select count(*) from vessl.staff_profiles)                                                  as n_staff,
    (select id from vessl.quotes order by id limit 1)                                            as probe_quote,
    (select count(*) from vessl.staff_profiles
      where (id = '6e4f384d-12fe-4999-899f-98822a7eb2c9' and length(email) = 28)
         or (id = '4917fcc7-acef-4ce7-89dd-df42baa34732' and length(email) = 24))               as n_probe_staff,
    (select count(*) from pg_trigger
      where tgrelid = 'vessl.staff_profiles'::regclass and tgname = 'trg_guard_staff_identity'
        and not tgisinternal)                                                                    as has_guard,
    -- Every row of both tables, every column, so b3 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
       from vessl.quotes q)                                                                      as h_quotes,
    (select md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
       from vessl.staff_profiles s)                                                              as h_staff;

do $guard$
begin
  if (select has_new from _pre116) <> 0 then
    raise exception 'one of the three new columns already exists, nothing changed';
  end if;
  if (select n_colacl from _pre116) <> 0 then
    raise exception 'quotes or staff_profiles has a column-level grant, so the new columns may need one too, nothing changed';
  end if;
  if (select n_quotes from _pre116) < 1 then
    raise exception 'no quotes to probe with, nothing changed';
  end if;
  if (select n_probe_staff from _pre116) <> 2 then
    raise exception 'the two staff rows the probes use are not where they were, nothing changed';
  end if;
  if (select has_guard from _pre116) <> 1 then
    raise exception 'trg_guard_staff_identity is missing, so script 110 is not in place, nothing changed';
  end if;
end
$guard$;

alter table vessl.quotes add column client_details text;
alter table vessl.quotes add column client_color text;
alter table vessl.staff_profiles add column job_title text;
comment on column vessl.quotes.client_details is
  'Details for the client price sheet, in words meant for the client (script 116).';
comment on column vessl.quotes.client_color is
  'Color for the client price sheet, in words meant for the client (script 116).';
comment on column vessl.staff_profiles.job_title is
  'Job title for the client price sheet sign-off, for example VP of Sales (script 116).';

create temp table _probe116 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  qid uuid := (select probe_quote from _pre116);
  st text; msg text;
begin
  -- p1 and p2, as Jenn -- a quote takes both, then both go back to blank.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
  perform set_config('vessl.change_note', 'script 116 probe, undone', true);
  begin
    execute 'set local role authenticated';
    update vessl.quotes set client_details = 'Probe details', client_color = 'Probe color' where id = qid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe116 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.quotes set client_details = 'Probe details', client_color = 'Probe color' where id = qid;
    update vessl.quotes set client_details = null, client_color = null where id = qid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe116 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p3 and p4, as Matt -- his own job_title, then Kristy row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'cd479d49-0662-48f4-9958-f649b7fd8638', 'email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set job_title = 'Probe title' where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    update vessl.staff_profiles set job_title = null where id = '6e4f384d-12fe-4999-899f-98822a7eb2c9';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe116 values (3, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.staff_profiles set job_title = 'Probe title' where id = '4917fcc7-acef-4ce7-89dd-df42baa34732';
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    insert into _probe116 values (4, case when st = 'P0001' then 'allowed ' || n::text
                                          when msg like '%by script%' then st || ' guard' else st || ' other' end);
  end;
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, no new columns, no column-level grants, a quote, both probe staff rows, the 110 guard' as chk,
         (select has_new::text || '/' || n_colacl::text || '/' || (n_quotes > 0)::text || '/'
                 || n_probe_staff::text || '/' || has_guard::text from _pre116) as got,
         '0/0/true/2/1' as want
  union all
  select 'b1 the three columns exist, text, nullable, no default',
         (select string_agg(table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                            || coalesce(column_default, 'none'), '/' order by table_name, column_name)
            from information_schema.columns
           where table_schema = 'vessl'
             and ((table_name = 'quotes' and column_name in ('client_details', 'client_color'))
               or (table_name = 'staff_profiles' and column_name = 'job_title'))),
         'quotes.client_color text YES none/quotes.client_details text YES none/staff_profiles.job_title text YES none'
  union all
  select 'b2 every quote unchanged, the two new columns blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(q) - 'client_details' - 'client_color')::text, '/' order by q.id), ''))
                           = (select h_quotes from _pre116) then 'same' else 'changed' end
                 || '/' || count(*) filter (where client_details is not null or client_color is not null)::text
            from vessl.quotes q),
         'same/0'
  union all
  select 'b3 every staff row unchanged, job_title blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(s) - 'job_title')::text, '/' order by s.id), ''))
                           = (select h_staff from _pre116) then 'same' else 'changed' end
                 || '/' || count(*) filter (where job_title is not null)::text
            from vessl.staff_profiles s),
         'same/0'
  union all
  select 'b4 same number of quotes and staff rows',
         ((select count(*) from vessl.quotes)::text || '/' || (select count(*) from vessl.staff_profiles)::text),
         (select n_quotes::text || '/' || n_staff::text from _pre116)
  union all
  select 'b5 probes -- staff set and clear a quote; own title saves; another person title refused by 110',
         (select string_agg(result, ' | ' order by step) from _probe116),
         'allowed 1 | allowed 1 | allowed 1 | 42501 guard'
  union all
  select 'b6 still no column-level grants on either table',
         (select count(*)::text from pg_attribute
           where attrelid in ('vessl.quotes'::regclass, 'vessl.staff_profiles'::regclass)
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
