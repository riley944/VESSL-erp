-- 102 -- PLM, sample types become a list staff can add to.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 102r.
--
-- WHY. The Sample type dropdown gets + Add new sample type (Loren, after 1 Oct).
-- A type added on one card has to be offered on every card at once, so the list
-- moves out of the code and the CHECK and into a table.
--
-- vessl.sample_types
--   key         text, the primary key, and what a round stores. The five keys
--               script 97 allowed are seeded as they are, so nothing stored on
--               a round changes. A type added from the app gets a generated key
--               (gen_random_uuid as text) -- staff never type or see one.
--   label       text, what the dropdown, the saved line and the files show.
--   active      boolean, default true. FALSE is retired -- kept so a round that
--               holds it still reads its label, never offered in the dropdown.
--               Testing is seeded FALSE, matching the dropdown since a58fdf3.
--   sort_order  integer. The four seeded types read 10 to 40 and Testing 50; an
--               added type is NULL and lists after them, alphabetically.
--   created_by, created_at -- who added it and when.
--
-- NEAR-DUPLICATES. A CHECK keeps every label trimmed, single-spaced, free of
-- tabs and line breaks and at most 60 characters, and a unique index on
-- lower(label) refuses the same name in another case. Together they refuse
-- First Sample, first sample and First  Sample as one name. The app collapses
-- the spacing before it inserts, so a person typing two spaces is corrected
-- rather than refused.
--
-- WHO CAN DO WHAT. Every privilege the schema default hands a new table is
-- revoked first, then authenticated gets SELECT, and INSERT on label and
-- created_by only -- so the key, active and sort_order always come from their
-- defaults. Row security on, two staff policies on vessl.is_staff(), SELECT and
-- INSERT. No UPDATE and no DELETE -- a type is retired later by script, never
-- removed. anon gets nothing.
--
-- THE ROUND COLUMN. program_sample_rounds_sample_type_check (script 97) is
-- dropped and a foreign key to sample_types(key) takes its place, so a round can
-- hold any listed type and nothing else. Values already stored all satisfy it --
-- the five seeded keys are the five the CHECK allowed. On 1 Oct every round
-- holds NULL. master_sample is untouched.
--
-- GUARDS, before any change. The table does not exist; the script 97 CHECK
-- hashes to the value measured on 1 Oct; every stored sample_type is one of the
-- five keys; the schema default for new tables is the measured one; the
-- ZZTESTPLM round the probes use exists.
--
-- PROBES, each undone, as a signed-in staff user (authenticated, mattdillon)
-- unless noted
--   p1  adding a new type is accepted, and it arrives active with no sort order
--   p2  the same name in another case is refused (unique)
--   p3  a label with a leading space, p4 with a double space, is refused (CHECK)
--   p5  choosing the key is refused (no column grant)
--   p6  editing a type, p7 deleting one, is refused (no grant)
--   p8  a round can take the key of a new type; p9 an unknown key is refused (FK)
--   p10 anon cannot read the list
--
-- NO EMAIL. Neither table has a mailing trigger.
--
-- WHAT A PASS LOOKS LIKE. z0 alone. Any a or b row is a failed check.

begin;

create temp table _pre102 on commit drop as
  select
    (to_regclass('vessl.sample_types') is null)::text                                            as no_table,
    (select md5(pg_get_constraintdef(oid)) from pg_constraint
      where conrelid = 'vessl.program_sample_rounds'::regclass
        and conname = 'program_sample_rounds_sample_type_check')                                 as h_check,
    (select count(*) from vessl.program_sample_rounds
      where sample_type is not null
        and sample_type not in ('first', 'pre_production', 'production', 'testing_production', 'testing')) as n_odd,
    (select array_to_string(d.defaclacl, ',') from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'vessl' and d.defaclobjtype = 'r')                                       as defacl,
    (select count(*) from vessl.program_sample_rounds
      where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid)                                   as probe_round,
    (select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
       from vessl.program_sample_rounds r)                                                       as h_rounds;

do $guard$
begin
  if (select no_table from _pre102) <> 'true' then
    raise exception 'vessl.sample_types already exists, nothing changed';
  end if;
  if (select h_check from _pre102) is distinct from '5b68497f21c009e671afbf682991d904' then
    raise exception 'the sample_type CHECK is not the script 97 one measured on 1 Oct, nothing changed';
  end if;
  if (select n_odd from _pre102) <> 0 then
    raise exception 'a round holds a sample type outside the five keys, nothing changed';
  end if;
  if (select defacl from _pre102) is distinct from 'authenticated=arwdDxtm/postgres' then
    raise exception 'the vessl default privileges are not as measured -- %, nothing changed', (select defacl from _pre102);
  end if;
  if (select probe_round from _pre102) <> 1 then
    raise exception 'the ZZTESTPLM round the probes use is missing, nothing changed';
  end if;
end
$guard$;

create table vessl.sample_types (
  key         text primary key default gen_random_uuid()::text,
  label       text not null,
  active      boolean not null default true,
  sort_order  integer,
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint sample_types_label_clean check (
        label = btrim(label)
    and label <> ''
    and length(label) <= 60
    and strpos(label, repeat(chr(32), 2)) = 0
    and position(chr(9) in label) = 0
    and position(chr(10) in label) = 0
    and position(chr(13) in label) = 0)
);
create unique index sample_types_label_ci on vessl.sample_types (lower(label));

comment on table vessl.sample_types is
  'Script 102. The sample types a round can hold, offered in the PLM Sample type dropdown when active. Staff add to it from the app; nobody updates or deletes from the app.';

insert into vessl.sample_types (key, label, active, sort_order, created_by) values
  ('first',              'First Sample',              true,  10, 'script 102'),
  ('pre_production',     'Pre-Production Sample',     true,  20, 'script 102'),
  ('production',         'Production Sample',         true,  30, 'script 102'),
  ('testing_production', 'Testing Production Sample', true,  40, 'script 102'),
  ('testing',            'Testing',                   false, 50, 'script 102');

revoke all on vessl.sample_types from public;
revoke all on vessl.sample_types from anon;
revoke all on vessl.sample_types from authenticated;
grant select on vessl.sample_types to authenticated;
grant insert (label, created_by) on vessl.sample_types to authenticated;

alter table vessl.sample_types enable row level security;
create policy sample_types_staff_select on vessl.sample_types
  for select to authenticated using (vessl.is_staff());
create policy sample_types_staff_insert on vessl.sample_types
  for insert to authenticated with check (vessl.is_staff());

alter table vessl.program_sample_rounds drop constraint program_sample_rounds_sample_type_check;
alter table vessl.program_sample_rounds add constraint program_sample_rounds_sample_type_fkey
  foreign key (sample_type) references vessl.sample_types (key);

comment on column vessl.program_sample_rounds.sample_type is
  'The key of a row in vessl.sample_types (script 102, which replaced the script 97 CHECK with this foreign key). NULL is Not set. master_sample is no longer read.';

create temp table _probe102 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  k text;
  act boolean;
  so integer;
begin
  -- p1, p2 -- add a type, then the same name in another case.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.sample_types (label, created_by) values ('Probe Gold Sample', 'mattdillon@kinguniversal.com')
    returning key, active, sort_order into k, act, so;
    begin
      insert into vessl.sample_types (label, created_by) values ('probe gold sample', 'mattdillon@kinguniversal.com');
      n = 0;
    exception when unique_violation then n = 1;
    end;
    raise exception 'probe undo';
  exception
    when raise_exception then
      insert into _probe102 values
        (1, (k is not null and length(k) = 36)::text || '/' || act::text || '/' || coalesce(so::text, 'null')),
        (2, case when n = 1 then 'refused' else 'accepted' end);
  end;

  -- p3 -- a leading space.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.sample_types (label) values (' Probe Spaced');
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe102 values (3, 'refused');
    when raise_exception then insert into _probe102 values (3, 'accepted');
  end;

  -- p4 -- a double space inside.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.sample_types (label) values ('Probe' || repeat(' ', 2) || 'Double');
    raise exception 'probe undo';
  exception
    when check_violation then insert into _probe102 values (4, 'refused');
    when raise_exception then insert into _probe102 values (4, 'accepted');
  end;

  -- p5 -- choosing the key.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.sample_types (key, label) values ('probe_key', 'Probe Keyed');
    raise exception 'probe undo';
  exception
    when insufficient_privilege then insert into _probe102 values (5, 'refused');
    when raise_exception then insert into _probe102 values (5, 'accepted');
  end;

  -- p6 -- editing a type.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.sample_types set label = 'Probe Renamed' where key = 'first';
    raise exception 'probe undo';
  exception
    when insufficient_privilege then insert into _probe102 values (6, 'refused');
    when raise_exception then insert into _probe102 values (6, 'accepted');
  end;

  -- p7 -- deleting a type.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from vessl.sample_types where key = 'first';
    raise exception 'probe undo';
  exception
    when insufficient_privilege then insert into _probe102 values (7, 'refused');
    when raise_exception then insert into _probe102 values (7, 'accepted');
  end;

  -- p8 -- a round takes a new type.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.sample_types (label) values ('Probe Round Type') returning key into k;
    update vessl.program_sample_rounds set sample_type = k where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe undo';
  exception
    when foreign_key_violation then insert into _probe102 values (8, 'refused');
    when raise_exception then insert into _probe102 select 8, case when n = 1 then 'ok' else 'norow' end;
  end;

  -- p9 -- a round cannot take a key that is not listed.
  begin
    update vessl.program_sample_rounds set sample_type = 'no_such_type'
     where id = '8a1aca76-6583-4449-9d05-37e5a2d4f064'::uuid;
    raise exception 'probe undo';
  exception
    when foreign_key_violation then insert into _probe102 values (9, 'refused');
    when raise_exception then insert into _probe102 values (9, 'accepted');
  end;

  -- p10 -- anon.
  begin
    execute 'set local role anon';
    perform count(*) from vessl.sample_types;
    raise exception 'probe undo';
  exception
    when insufficient_privilege then insert into _probe102 values (10, 'refused');
    when raise_exception then insert into _probe102 values (10, 'accepted');
  end;
end
$probe$;

-- VERIFICATION. z0 alone is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'a0 no table yet, the script 97 CHECK, no odd values, the default privileges, the probe round' as chk,
         (select no_table || '/' || (h_check = '5b68497f21c009e671afbf682991d904')::text || '/' || n_odd::text
                 || '/' || defacl || '/' || probe_round::text from _pre102) as got,
         'true/true/0/authenticated=arwdDxtm/postgres/1' as want
  union all
  select 'b1 five seeded types, four active, keys and label lengths in sort order',
         (select count(*)::text || '/' || count(*) filter (where active)::text || '/'
                 || string_agg(key || ' ' || length(label)::text, ',' order by sort_order)
            from vessl.sample_types),
         '5/4/first 12,pre_production 21,production 17,testing_production 25,testing 7'
  union all
  select 'b2 authenticated -- select yes, insert on label and created_by only, no update, no delete, no truncate; anon nothing',
         (select has_table_privilege('authenticated', 'vessl.sample_types', 'SELECT')::text
                 || '/' || has_column_privilege('authenticated', 'vessl.sample_types', 'label', 'INSERT')::text
                 || '/' || has_column_privilege('authenticated', 'vessl.sample_types', 'key', 'INSERT')::text
                 || '/' || has_column_privilege('authenticated', 'vessl.sample_types', 'active', 'INSERT')::text
                 || '/' || has_table_privilege('authenticated', 'vessl.sample_types', 'UPDATE')::text
                 || '/' || has_table_privilege('authenticated', 'vessl.sample_types', 'DELETE')::text
                 || '/' || has_table_privilege('authenticated', 'vessl.sample_types', 'TRUNCATE')::text
                 || '/' || has_table_privilege('anon', 'vessl.sample_types', 'SELECT')::text),
         'true/true/false/false/false/false/false/false'
  union all
  select 'b3 row security on, two policies -- select and insert, both permissive',
         (select c.relrowsecurity::text || '/' || count(p.*)::text || '/'
                 || string_agg(p.polcmd::text, '' order by p.polcmd) || '/' || bool_and(p.polpermissive)::text
            from pg_class c left join pg_policy p on p.polrelid = c.oid
           where c.oid = 'vessl.sample_types'::regclass
           group by c.relrowsecurity),
         'true/2/ar/true'
  union all
  select 'b4 the round CHECK is gone and the foreign key to sample_types is in its place',
         (select (select count(*) from pg_constraint
                   where conrelid = 'vessl.program_sample_rounds'::regclass
                     and conname = 'program_sample_rounds_sample_type_check')::text
                 || '/' || (select confrelid::regclass::text from pg_constraint
                             where conrelid = 'vessl.program_sample_rounds'::regclass
                               and conname = 'program_sample_rounds_sample_type_fkey')),
         '0/vessl.sample_types'
  union all
  select 'b5 probes 1 to 10',
         (select string_agg(result, ' | ' order by step) from _probe102),
         'true/true/null | refused | refused | refused | refused | refused | refused | ok | refused | refused'
  union all
  select 'b6 the probes left nothing -- five types, every round as it was',
         (select (select count(*) from vessl.sample_types)::text || '/'
                 || ((select md5(coalesce(string_agg(to_jsonb(r)::text, '/' order by r.id), ''))
                        from vessl.program_sample_rounds r) = h_rounds)::text
            from _pre102),
         '5/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
