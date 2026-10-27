-- 115 -- Tasks record when their person first opened them, in seen_at.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 115r.
--
-- WHAT IT DOES. One column, nothing else.
--   seen_at, nullable timestamptz, no default, on vessl.tasks. NULL is unread.
-- Every existing task reads NULL -- no backfill, so the open ones start unread.
--
-- NO GRANT CHANGES. The app already updates tasks (done, done_at) as a signed-in
-- user, so the table carries an update grant for authenticated, and a table grant
-- covers columns added later. The guard checks that no column of the table
-- carries a column-level grant (pg_attribute.attacl is null on every column).
-- The policies on tasks are FOR ALL and name no columns. Probe p1 proves a
-- signed-in staff user can write the new column.
--
-- GUARDS, before any change.
--   seen_at does not exist yet
--   no column of the table has a column-level grant
--   there is at least one task, for the probes to use
--
-- PROBES, each undone. As Jenn signed in through the app (authenticated, a
-- kinguniversal.com identity) -- seen_at set, then set back to NULL, each
-- accepted. As a signed-in identity outside kinguniversal.com, the same update
-- reaches no row, since the restrictive kui_staff_only policy hides the table.
--
-- WHAT A PASS LOOKS LIKE. One row, z0, on the rehearsal and again on the commit.
-- Any a or b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre115 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'tasks'
        and column_name = 'seen_at')                                                             as has_new,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.tasks'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.tasks)                                                           as n_tasks,
    (select count(*) from vessl.tasks where not coalesce(done, false))                           as n_open,
    (select id from vessl.tasks order by id limit 1)                                             as probe_id,
    -- Every task, every column, so b3 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(t)::text, '/' order by t.id), ''))
       from vessl.tasks t)                                                                       as h_rows;

do $guard$
begin
  if (select has_new from _pre115) <> 0 then
    raise exception 'seen_at already exists, nothing changed';
  end if;
  if (select n_colacl from _pre115) <> 0 then
    raise exception 'a column of tasks has a column-level grant, so seen_at may need one too, nothing changed';
  end if;
  if (select n_tasks from _pre115) < 1 then
    raise exception 'no tasks to probe with, nothing changed';
  end if;
end
$guard$;

alter table vessl.tasks add column seen_at timestamptz;
comment on column vessl.tasks.seen_at is
  'When the person the task is for first opened it in the app (script 115). NULL is unread.';

create temp table _probe115 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  pid uuid := (select probe_id from _pre115);
  st text;
begin
  -- p1 and p2, as a signed-in staff user -- seen_at set, then blank again.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    update vessl.tasks set seen_at = now() where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe115 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  begin
    execute 'set local role authenticated';
    update vessl.tasks set seen_at = now() where id = pid;
    update vessl.tasks set seen_at = null where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe115 values (2, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p3, as a signed-in identity outside kinguniversal.com -- no row is reached.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000115', 'email', '<contact>', 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    update vessl.tasks set seen_at = now() where id = pid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe115 values (3, case when st = 'P0001' then 'reached ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. One row reading z0 is a pass. More rows means those checks
-- failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, no seen_at, no column-level grants, at least one task' as chk,
         (select has_new::text || '/' || n_colacl::text || '/' || (n_tasks > 0)::text from _pre115) as got,
         '0/0/true' as want
  union all
  select 'b1 seen_at exists, timestamptz, nullable, no default',
         (select column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'tasks' and column_name = 'seen_at'),
         'seen_at timestamp with time zone YES none'
  union all
  select 'b2 every existing task unchanged, seen_at blank on all',
         (select case when md5(coalesce(string_agg((to_jsonb(t) - 'seen_at')::text, '/' order by t.id), ''))
                           = (select h_rows from _pre115) then 'same' else 'changed' end
                 || '/' || count(*) filter (where seen_at is not null)::text
            from vessl.tasks t),
         'same/0'
  union all
  select 'b3 same number of tasks, same number open',
         ((select count(*) from vessl.tasks)::text || '/'
          || (select count(*) from vessl.tasks where not coalesce(done, false))::text),
         (select n_tasks::text || '/' || n_open::text from _pre115)
  union all
  select 'b4 probes -- staff can set and clear seen_at; outside kinguniversal.com reaches nothing',
         (select string_agg(result, ' | ' order by step) from _probe115),
         'allowed 1 | allowed 1 | reached 0'
  union all
  select 'b5 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.tasks'::regclass
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
