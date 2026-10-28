-- 139 -- Which item of its PDF a quote was imported from.
--
-- RUN AS postgres IN THE SQL EDITOR. One transaction. Reversed by 139r.
-- Run this BEFORE the code that writes it is deployed -- Save of an imported
-- quote will send pdf_item, and a write naming a column the database does not
-- have fails the whole Save. The code now live never names it.
--
-- WHAT IT DOES. One column, its CHECK, its comment, nothing else.
--   quotes.pdf_item  jsonb null  the item of quotes.pdf_path this quote was
--                                filled from -- an object with page (1-based),
--                                anchor (the words printed on that row, to find
--                                it on the page) and item_name. Null = not
--                                imported, or imported before this script.
--   CHECK quotes_pdf_item_object  null or a JSON object
-- No default and no backfill -- every existing quote reads null.
--
-- NO GRANT OR POLICY CHANGES. quotes is staff only (kui_staff_only, restrictive,
-- plus staff_only and auth quotes). Table grants cover columns added later, and
-- the guard checks no column carries a column-level grant. The one trigger,
-- trg_quote_code, only keeps quote_code on update, so the probes write nothing
-- beyond their own row.
--
-- GUARDS, before any change.
--   pdf_item does not exist yet, pdf_path does
--   the probe row is as measured -- quote 5e39d303, client ZZTESTER, length 8
--   no column of quotes has a column-level grant; the only trigger is trg_quote_code
--
-- PROBES, each undone. Jenn is staff; the other user is signed in, not staff.
--   p1 As Jenn, setting pdf_item on the ZZTESTER quote updates 1 row.
--   p2 As Jenn, setting pdf_item to an array is refused (23514).
--   p3 As the user who is not staff, the p1 update reaches no row (0).
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0, on the rehearsal and again on the
-- commit. Any b row is a failed check. Zero rows means the query did not run.

begin;

create temp table _pre139 on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_item')       as n_item,
    (select count(*) from information_schema.columns
      where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_path')       as n_path,
    (select count(*) from vessl.quotes
      where id = '5e39d303-be6b-47b1-88e7-238c1763f29f'::uuid and length(client) = 8)            as n_probe,
    (select count(*) from pg_attribute
      where attrelid = 'vessl.quotes'::regclass
        and attnum > 0 and not attisdropped and attacl is not null)                             as n_colacl,
    (select coalesce(string_agg(tgname::text, ',' order by tgname), '') from pg_trigger
      where not tgisinternal and tgrelid = 'vessl.quotes'::regclass)                            as trigs,
    (select count(*) from vessl.quotes)                                                          as n_q,
    -- Every row, every column, so b4 can prove no existing value moved.
    (select md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
       from vessl.quotes q)                                                                      as h_q;

do $guard$
begin
  if (select n_item from _pre139) <> 0 then
    raise exception 'quotes.pdf_item already exists, nothing changed';
  end if;
  if (select n_path from _pre139) <> 1 then
    raise exception 'quotes.pdf_path is not there, so 129 was not committed, nothing changed';
  end if;
  if (select n_probe from _pre139) <> 1 then
    raise exception 'the probe quote (ZZTESTER) is not as measured, nothing changed';
  end if;
  if (select n_colacl from _pre139) <> 0 then
    raise exception 'a column of quotes has a column-level grant, so the new column may need one too, nothing changed';
  end if;
  if (select trigs from _pre139) <> 'trg_quote_code' then
    raise exception 'quotes has a trigger other than trg_quote_code, so the probes may write elsewhere, nothing changed';
  end if;
end
$guard$;

alter table vessl.quotes add column pdf_item jsonb;
alter table vessl.quotes add constraint quotes_pdf_item_object
  check (pdf_item is null or jsonb_typeof(pdf_item) = 'object');

comment on column vessl.quotes.pdf_item is 'Script 139. The item of pdf_path this quote was imported from -- {page, anchor, item_name}. page is 1-based, anchor the words printed on that row. Null = not imported from a PDF item.';

create temp table _probe139 (step int, result text) on commit drop;

do $probe$
declare
  n integer;
  st text;
begin
  -- p1, as Jenn -- an object.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.quotes set pdf_item = jsonb_build_object('page', 1, 'anchor', 'ZZ probe row', 'item_name', 'ZZ probe')
     where id = '5e39d303-be6b-47b1-88e7-238c1763f29f'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe139 values (1, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;

  -- p2, as Jenn -- an array is refused.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '79bc7b97-ffaf-4c67-a4bd-e149fc3de49a', 'email', 'jenn@kinguniversal.com', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.quotes set pdf_item = jsonb_build_array(1, 2)
     where id = '5e39d303-be6b-47b1-88e7-238c1763f29f'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe139 values (2, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;

  -- p3, as a signed-in user who is not staff -- the p1 update.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', '00000000-0000-4000-8000-000000001390', 'email', 'zz139-outsider@vessl.io', 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update vessl.quotes set pdf_item = jsonb_build_object('page', 1)
     where id = '5e39d303-be6b-47b1-88e7-238c1763f29f'::uuid;
    get diagnostics n = row_count;
    raise exception 'probe done' using errcode = 'P0001';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    insert into _probe139 values (3, case when st = 'P0001' then 'updated ' || n::text else st end);
  end;
end
$probe$;

-- VERIFICATION. a0 and z0 always show and are a pass. Any b row is a failed
-- check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, quotes = ' || (select n_q::text from _pre139) as chk,
         'shown'::text as got, 'always'::text as want
  union all
  select 'b1 pdf_item, jsonb, nullable, no default',
         (select count(*)::text || '/' || count(*) filter (where data_type = 'jsonb' and is_nullable = 'YES' and column_default is null)::text
            from information_schema.columns
           where table_schema = 'vessl' and table_name = 'quotes' and column_name = 'pdf_item'),
         '1/1'::text
  union all
  select 'b2 the column carries the script 139 comment, the CHECK is there',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.quotes'::regclass
             and attname = 'pdf_item' and col_description(attrelid, attnum) like 'Script 139.%')
           || '/' || (select count(*)::text from pg_constraint
                       where conrelid = 'vessl.quotes'::regclass and conname = 'quotes_pdf_item_object'),
         '1/1'::text
  union all
  select 'b3 every row reads null',
         (select count(pdf_item)::text from vessl.quotes),
         '0'::text
  union all
  select 'b4 every existing quote column unchanged',
         (select case when md5(coalesce(string_agg((to_jsonb(q) - 'pdf_item')::text, '/' order by q.id), ''))
                           = (select h_q from _pre139) then 'same' else 'changed' end
            from vessl.quotes q),
         'same'::text
  union all
  select 'b5 probes -- staff sets it, an array is refused, non-staff reaches nothing',
         (select string_agg(result, ' | ' order by step) from _probe139),
         'updated 1 | 23514 | updated 0'::text
  union all
  select 'b6 still no column-level grants',
         (select count(*)::text from pg_attribute
           where attrelid = 'vessl.quotes'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0'::text
  union all
  select 'z0 verification ran, quotes = ' || (select count(*)::text from vessl.quotes),
         'shown'::text, 'always'::text
) r
where got is distinct from want
   or chk like 'a0%'
   or chk like 'z0%'
order by chk;

-- Two rows, a0 and z0? Then swap these two lines.
-- commit;
rollback;
