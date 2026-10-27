-- 121 -- PO notes can notify several people, in order_notes.notify_to.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 121r.
-- Run this BEFORE the code that reads notify_to is deployed -- the new
-- /api/orders/notify selects it and fails without it. The code now live never
-- names the column, so adding it changes nothing for the live site.
--
-- WHAT IT DOES. One column, its CHECK and a back-fill, nothing else.
--   notify_to, nullable text[], no default. NULL is All (the whole team). A
--   list is the people picked on the NOTIFY pills, as email addresses.
--   order_notes_notify_to_check allows NULL or a list of at least one entry
--   with no NULL in it -- so All has one spelling, NULL, never an empty list.
--   Back-fill. Every note with an assigned_to gets notify_to = that one
--   address. assigned_to itself is left exactly as it is, and stays until a
--   later script drops it once nothing reads it.
--
-- NO GRANT CHANGES. authenticated holds select, insert, update and delete ON
-- THE TABLE, not column by column, and a table grant covers a column added
-- later. The guard checks no column carries a column-level grant (attacl is
-- null on every column). The staff_only and kui_staff_only policies are FOR
-- ALL and name no columns. Probe p1 proves a signed-in staff user can write it.
--
-- GUARDS, before any change.
--   vessl.order_notes exists and notify_to does not exist yet
--   no column of the table has a column-level grant
--
-- PROBES, each undone. As Jenn signed in through the app (authenticated, a
-- kinguniversal.com identity), a note with a two-person notify_to is accepted.
-- As postgres, a note with notify_to NULL is accepted, and an empty list and a
-- list holding a NULL are each refused by the CHECK (23514).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 (the counts before) and z0, on the
-- rehearsal and again on the commit. Any b row is a failed check. Zero rows
-- means the query did not run.

begin;

create temp table _pre121 on commit drop as
  select
    (select count(*) from information_schema.tables
      where table_schema = 'vessl' and table_name = 'order_notes')                                as has_table,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'order_notes'
        and column_name = 'notify_to')                                                           as has_col,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.order_notes'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select count(*) from vessl.order_notes)                                                     as n_notes,
    (select count(*) from vessl.order_notes where assigned_to is not null)                       as n_assigned,
    -- Every note, every column, so b3 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(n)::text, '/' order by n.id), ''))
       from vessl.order_notes n)                                                                 as h_rows;

do $guard$
begin
  if (select has_table from _pre121) <> 1 then
    raise exception 'vessl.order_notes is missing, nothing changed';
  end if;
  if (select has_col from _pre121) <> 0 then
    raise exception 'notify_to already exists, nothing changed';
  end if;
  if (select n_colacl from _pre121) <> 0 then
    raise exception 'a column of order_notes has a column-level grant, so the new column may need one too, nothing changed';
  end if;
end
$guard$;

alter table vessl.order_notes add column notify_to text[];
alter table vessl.order_notes add constraint order_notes_notify_to_check
  check (notify_to is null or (cardinality(notify_to) >= 1 and array_position(notify_to, null) is null));
comment on column vessl.order_notes.notify_to is
  'Script 121. Who the note was sent to, as the NOTIFY pills picked them -- email addresses. NULL is All, the whole team. Replaces assigned_to, which held one address.';

update vessl.order_notes
   set notify_to = array[assigned_to]
 where assigned_to is not null;

create temp table _probe121 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);

  -- p1, as a signed-in staff user -- a note for two people.
  begin
    execute 'set local role authenticated';
    insert into vessl.order_notes (body, author_email, notify_to)
      values ('script 121 probe', 'jenn@kinguniversal.com', array['riley@kinguniversal.com', 'mattdillon@kinguniversal.com']);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe121 values (1, case when st = 'P0001' then 'allowed ' || n::text else st end);
  end;

  -- p2 to p4, as postgres -- All is NULL; an empty list and a NULL entry refused.
  begin
    insert into vessl.order_notes (body, author_email, notify_to)
      values ('script 121 probe', 'jenn@kinguniversal.com', null);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe121 values (2, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.order_notes (body, author_email, notify_to)
      values ('script 121 probe', 'jenn@kinguniversal.com', array[]::text[]);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe121 values (3, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;

  begin
    insert into vessl.order_notes (body, author_email, notify_to)
      values ('script 121 probe', 'jenn@kinguniversal.com', array['riley@kinguniversal.com', null]);
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe121 values (4, case when st = 'P0001' then 'accepted ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, notes = ' || (select n_notes::text from _pre121)
           || ', with assigned_to = ' || (select n_assigned::text from _pre121) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 notify_to exists, is text[], nullable, no default',
         (select data_type || '/' || udt_name || '/' || is_nullable || '/' || coalesce(column_default, 'none')
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'order_notes' and column_name = 'notify_to')::text,
         'ARRAY/_text/YES/none'::text
  union all
  select 'b2 the CHECK exists and is validated',
         (select count(*)::text || '/' || coalesce(bool_and(convalidated)::text, 'none') from pg_constraint
           where conrelid = 'vessl.order_notes'::regclass and conname = 'order_notes_notify_to_check'),
         '1/true'::text
  union all
  select 'b3 every note unchanged apart from notify_to',
         (select case when md5(coalesce(string_agg((to_jsonb(n) - 'notify_to')::text, '/' order by n.id), ''))
                           = (select h_rows from _pre121) then 'same' else 'changed' end
            from vessl.order_notes n),
         'same'::text
  union all
  select 'b4 back-fill, notes with notify_to = notes with assigned_to, each the one address',
         (select count(*) filter (where notify_to is not null)::text || '/'
                 || count(*) filter (where notify_to = array[assigned_to])::text
            from vessl.order_notes),
         (select n_assigned::text || '/' || n_assigned::text from _pre121)
  union all
  select 'b5 same number of notes',
         (select count(*)::text from vessl.order_notes), (select n_notes::text from _pre121)
  union all
  select 'b6 probes -- staff two-person list allowed; NULL accepted; empty list and NULL entry refused',
         (select string_agg(result, ' | ' order by step) from _probe121),
         'allowed 1 | accepted 1 | 23514 | 23514'::text
  union all
  select 'b7 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.order_notes'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, notes with notify_to = '
           || (select count(*)::text from vessl.order_notes where notify_to is not null),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
