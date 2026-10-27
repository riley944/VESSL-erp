-- 103 -- Quotes, a short unique Quote ID that never changes -- Q-0001, Q-0002, and on.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 103r.
--
-- WHY. Loren needs to name a quote by something short and permanent, and to
-- create a PLM card from it (1 Oct). Today a quote has only its uuid.
--
-- WHAT IT DOES
--   1. A new column, vessl.quotes.quote_code, text. quote_num is NOT touched --
--      it stays as it is, Riley 2026-000-0001 included (a0 and b6 check).
--   2. A sequence, vessl.quote_code_seq. Every privilege the vessl default hands
--      a new sequence (authenticated rwU) is revoked, so no signed-in user can
--      advance or reset the counter; only the function below uses it.
--   3. Every existing quote numbered oldest first by created_at, ties by id --
--      Q-0001 is the first quote ever saved. Measured on 1 Oct -- 355 quotes, no
--      created_at ties, none missing. The count is not hard-coded; b2 and b3
--      check the numbering against whatever is there when this runs.
--   4. NOT NULL, UNIQUE, and a CHECK on the shape -- Q, a hyphen, at least four
--      digits. Past Q-9999 the number simply grows to five digits.
--   5. vessl.assign_quote_code(), a trigger function, SECURITY DEFINER, owned by
--      postgres, empty search_path, EXECUTE revoked from PUBLIC, anon and
--      authenticated. trg_quote_code runs it BEFORE INSERT OR UPDATE.
--        on INSERT  -- the next number, always, whatever the row arrived with,
--                      so a duplicated quote can never carry its original code
--        on UPDATE  -- the code the row already had, so it never changes
--      Because the number comes from the sequence, two saves at the same moment
--      cannot get the same one.
--   6. The sequence is set last, after the probes, so the next real quote gets
--      the number after the highest one stored -- the probes take numbers from
--      the sequence and those numbers are not given back by a rollback.
--
-- GUARDS. quote_code and quote_code_seq do not exist; the function and trigger
-- do not exist; no other trigger on quotes; every quote has a created_at; the
-- vessl sequence default is the measured one.
--
-- PROBES, each undone, as a signed-in staff user (authenticated, mattdillon)
--   p1 a new quote gets the next code
--   p2 a new quote that brings its own code still gets the next code
--   p3 an update cannot change a code
--   p4 a copy of an existing quote row gets a new code, not the original
--
-- NO EMAIL. quotes has no mailing trigger.
--
-- WHAT A PASS LOOKS LIKE. r1 (the first and last codes issued) plus z0. Any a
-- or b row is a failed check.

begin;

create temp table _pre103 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'quote_code')     as has_col,
    (to_regclass('vessl.quote_code_seq') is null)::text                                          as no_seq,
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'vessl' and p.proname = 'assign_quote_code')                             as has_fn,
    (select count(*) from pg_trigger where tgrelid = 'vessl.quotes'::regclass and not tgisinternal) as n_trg,
    (select count(*) from vessl.quotes where created_at is null)                                 as no_created,
    (select array_to_string(d.defaclacl, ',') from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'vessl' and d.defaclobjtype = 'S')                                       as seq_defacl,
    (select count(*) from vessl.quotes)                                                          as n_quotes,
    (select md5(coalesce(string_agg(id::text || '=' || quote_num, ',' order by id), ''))
       from vessl.quotes where quote_num is not null)                                            as h_quote_num,
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), '')) from vessl.quotes q) as h_quotes;

do $guard$
begin
  if (select has_col from _pre103) <> 0 or (select no_seq from _pre103) <> 'true'
     or (select has_fn from _pre103) <> 0 then
    raise exception 'quote_code, its sequence or its function already exists, nothing changed';
  end if;
  if (select n_trg from _pre103) <> 0 then
    raise exception 'quotes already has a trigger, nothing changed';
  end if;
  if (select no_created from _pre103) <> 0 then
    raise exception 'a quote has no created_at, so the order is not defined, nothing changed';
  end if;
  if (select seq_defacl from _pre103) is distinct from 'authenticated=rwU/postgres' then
    raise exception 'the vessl sequence default privileges are not as measured -- %, nothing changed',
      (select seq_defacl from _pre103);
  end if;
end
$guard$;

create sequence vessl.quote_code_seq;
revoke all on sequence vessl.quote_code_seq from public;
revoke all on sequence vessl.quote_code_seq from anon;
revoke all on sequence vessl.quote_code_seq from authenticated;

alter table vessl.quotes add column quote_code text;

-- Oldest first, ties by id. lpad to the longer of 4 and the number itself, so
-- Q-12345 is not cut to Q-1234 once there are ten thousand quotes.
with ordered as (
  select id, row_number() over (order by created_at, id) as n from vessl.quotes
)
update vessl.quotes q
   set quote_code = 'Q-' || lpad(o.n::text, greatest(4, length(o.n::text)), '0')
  from ordered o
 where o.id = q.id;

alter table vessl.quotes alter column quote_code set not null;
alter table vessl.quotes add constraint quotes_quote_code_key unique (quote_code);
alter table vessl.quotes add constraint quotes_quote_code_shape check (quote_code ~ '^Q-[0-9]{4,}$');

comment on column vessl.quotes.quote_code is
  'Script 103. The Quote ID -- Q-0001 and on, issued by trg_quote_code on insert from vessl.quote_code_seq and never changed after. Existing quotes numbered oldest first by created_at. quote_num is a separate, older column.';

create function vessl.assign_quote_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  n bigint;
begin
  if tg_op = 'INSERT' then
    n = nextval('vessl.quote_code_seq');
    new.quote_code = 'Q-' || lpad(n::text, greatest(4, length(n::text)), '0');
  else
    new.quote_code = old.quote_code;
  end if;
  return new;
end
$fn$;

comment on function vessl.assign_quote_code() is
  'Script 103. Gives a new quote the next Quote ID and keeps an existing one from changing.';

revoke all on function vessl.assign_quote_code() from public;
revoke all on function vessl.assign_quote_code() from anon;
revoke all on function vessl.assign_quote_code() from authenticated;

create trigger trg_quote_code
  before insert or update on vessl.quotes
  for each row
  execute function vessl.assign_quote_code();

-- The counter starts after the highest number stored, for the probes.
select setval('vessl.quote_code_seq', (select count(*) from vessl.quotes), true);

create temp table _probe103 (step int, result text) on commit drop;

do $probe$
declare
  want text;
  got text;
  nid uuid;
  before_code text;
  nxt bigint;
begin
  -- p1 -- a new quote gets the next code.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    nxt = (select count(*) from vessl.quotes) + 1;
    want = 'Q-' || lpad(nxt::text, greatest(4, length(nxt::text)), '0');
    insert into vessl.quotes (product, client) values ('probe 103', 'ZZTESTER') returning quote_code into got;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe103 values (1, (got = want)::text);
  end;

  -- p2 -- a new quote that brings its own code.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into vessl.quotes (product, client, quote_code) values ('probe 103', 'ZZTESTER', 'Q-0001') returning quote_code into got;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe103 values (2, (got <> 'Q-0001' and got ~ '^Q-[0-9]{4,}$')::text);
  end;

  -- p3 -- an update cannot change a code.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select id, quote_code into nid, before_code from vessl.quotes order by created_at, id limit 1;
    update vessl.quotes set quote_code = 'Q-9999' where id = nid;
    select quote_code into got from vessl.quotes where id = nid;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe103 values (3, (got = before_code)::text);
  end;

  -- p4 -- a copy of an existing row, code and all, gets a new code.
  begin
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', 'mattdillon@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select id, quote_code into nid, before_code from vessl.quotes order by created_at, id limit 1;
    insert into vessl.quotes (product, client, quote_code)
    select product, client, quote_code from vessl.quotes where id = nid
    returning quote_code into got;
    raise exception 'probe undo';
  exception
    when raise_exception then insert into _probe103 values (4, (got <> before_code)::text);
  end;
end
$probe$;

-- The probes took numbers from the sequence. Set it back so the next real
-- quote gets the number after the highest one stored.
select setval('vessl.quote_code_seq', (select count(*) from vessl.quotes), true);

-- VERIFICATION. r1 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r1 codes issued -- first, last, and the next a new quote will get' as chk,
         ((select quote_code from vessl.quotes order by created_at, id limit 1)
          || ' .. ' || (select quote_code from vessl.quotes order by created_at desc, id desc limit 1)
          || ' -- next Q-' || lpad(((select last_value from vessl.quote_code_seq) + 1)::text,
                                   greatest(4, length(((select last_value from vessl.quote_code_seq) + 1)::text)), '0'))::text as got,
         'shown every run' as want
  union all
  select 'a0 nothing existed, no trigger on quotes, every quote dated, the sequence default as measured',
         (select has_col::text || '/' || no_seq || '/' || has_fn::text || '/' || n_trg::text || '/'
                 || no_created::text || '/' || seq_defacl from _pre103),
         '0/true/0/0/0/authenticated=rwU/postgres'
  union all
  select 'b1 every quote has a code, all different, and the count is unchanged',
         (select count(*)::text || '/' || count(quote_code)::text || '/' || count(distinct quote_code)::text from vessl.quotes),
         (select n_quotes::text || '/' || n_quotes::text || '/' || n_quotes::text from _pre103)
  union all
  select 'b2 the numbers run 1 to the count with no gap, in created_at order',
         (select count(*)::text from (
            select quote_code, row_number() over (order by created_at, id) as n from vessl.quotes) x
           where substr(quote_code, 3)::bigint <> n),
         '0'
  union all
  select 'b3 the sequence stands at the highest number stored',
         (select ((select last_value from vessl.quote_code_seq) = (select count(*) from vessl.quotes))::text
                 || '/' || (select is_called from vessl.quote_code_seq)::text),
         'true/true'
  union all
  select 'b4 not null, unique, shape check, trigger before insert or update -- and nobody but postgres on the sequence or function',
         ((select is_nullable from information_schema.columns
            where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'quote_code')
          || '/' || (select count(*) from pg_constraint where conrelid = 'vessl.quotes'::regclass
                      and conname in ('quotes_quote_code_key', 'quotes_quote_code_shape'))::text
          || '/' || (select tgtype::text from pg_trigger where tgrelid = 'vessl.quotes'::regclass and tgname = 'trg_quote_code')
          || '/' || has_sequence_privilege('authenticated', 'vessl.quote_code_seq', 'USAGE')::text
          || '/' || has_sequence_privilege('authenticated', 'vessl.quote_code_seq', 'UPDATE')::text
          || '/' || has_function_privilege('authenticated', 'vessl.assign_quote_code()', 'EXECUTE')::text
          || '/' || (select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc
                      where oid = 'vessl.assign_quote_code()'::regprocedure)),
         'NO/2/23/false/false/false/true search_path=""'
  union all
  select 'b5 probes -- next code on insert, own code ignored, update kept the code, a copy got a new code',
         (select string_agg(result, '/' order by step) from _probe103), 'true/true/true/true'
  union all
  select 'b6 quote_num untouched, and every other column of every quote unchanged',
         (select (md5(coalesce(string_agg(id::text || '=' || quote_num, ',' order by id), '')) = p.h_quote_num)::text
            from vessl.quotes, _pre103 p where quote_num is not null group by p.h_quote_num)
         || '/' || (select (md5(coalesce(string_agg((to_jsonb(q) - 'quote_code')::text, '/' order by q.id), '')) = p.h_quotes)::text
                      from vessl.quotes q, _pre103 p group by p.h_quotes),
         'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r1? Then swap these two lines.
-- commit;
rollback;
